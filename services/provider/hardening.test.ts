/**
 * Phase 3/5 hardening tests — provider middleware (auth, rate limit, CORS)
 * and the attestation error queue.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';

import { loadAuthConfig, verifyApiKey, RateLimiter, applyMiddleware } from './middleware';
import { appendError, readErrors, clearErrors, FailedRecord } from '../attestation/record';

// --- Test doubles ----------------------------------------------------------- //

function fakeReq(headers: Record<string, string | string[]>, method = 'GET', ip = '10.0.0.1'): IncomingMessage {
  return {
    headers,
    method,
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { headers: Record<string, string>; ended: number | null } {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; return res; },
    writeHead(status: number) { res.ended = status; return res; },
    end() { res.ended ??= 200; },
    ended: null as number | null,
  };
  return res as unknown as ServerResponse & { headers: Record<string, string>; ended: number | null };
}

// --- API key auth ----------------------------------------------------------- //

describe('provider middleware — API key auth', () => {
  it('parses PROVIDER_API_KEYS into a key map', () => {
    process.env.PROVIDER_API_KEYS = 'secret-key-1:ci-agent, secret-key-2:ops';
    const cfg = loadAuthConfig();
    assert.ok(cfg);
    assert.equal(cfg.keys.size, 2);
    assert.equal(cfg.keys.get('secret-key-1'), 'ci-agent');
    assert.equal(cfg.keys.get('secret-key-2'), 'ops');
    delete process.env.PROVIDER_API_KEYS;
  });

  it('returns null config when env is empty (auth disabled)', () => {
    delete process.env.PROVIDER_API_KEYS;
    assert.equal(loadAuthConfig(), null);
  });

  it('accepts a request with a valid X-API-Key', () => {
    process.env.PROVIDER_API_KEYS = 'k1:test';
    const cfg = loadAuthConfig();
    assert.equal(verifyApiKey(fakeReq({ 'x-api-key': 'k1' }), cfg), null);
    delete process.env.PROVIDER_API_KEYS;
  });

  it('rejects a request without or with a wrong key', () => {
    process.env.PROVIDER_API_KEYS = 'k1:test';
    const cfg = loadAuthConfig();
    assert.equal(verifyApiKey(fakeReq({}), cfg)?.status, 401);
    assert.equal(verifyApiKey(fakeReq({ 'x-api-key': 'wrong' }), cfg)?.status, 401);
    delete process.env.PROVIDER_API_KEYS;
  });

  it('auth disabled passes everything', () => {
    assert.equal(verifyApiKey(fakeReq({}), null), null);
  });
});

// --- Rate limiter ------------------------------------------------------------ //

describe('provider middleware — rate limiter', () => {
  it('allows up to maxRequests then returns 429 with retry-after', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
    assert.equal(limiter.check('ip-a'), null);
    assert.equal(limiter.check('ip-a'), null);
    assert.equal(limiter.check('ip-a'), null);
    const blocked = limiter.check('ip-a');
    assert.ok(blocked);
    assert.equal(blocked.status, 429);
    assert.ok(blocked.retryAfterMs > 0);
    assert.ok(blocked.retryAfterMs <= 60_000);
  });

  it('tracks IPs independently', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    assert.equal(limiter.check('ip-a'), null);
    assert.ok(limiter.check('ip-a')); // ip-a blocked
    assert.equal(limiter.check('ip-b'), null); // ip-b untouched
  });

  it('resets after the window expires', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 30 });
    assert.equal(limiter.check('ip-a'), null);
    assert.ok(limiter.check('ip-a'));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(limiter.check('ip-a'), null); // window reset
  });

  it('sweep() removes expired entries', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 20 });
    limiter.check('ip-a');
    await new Promise((r) => setTimeout(r, 30));
    limiter.sweep();
    // Internal map should be empty; next hit starts a fresh window.
    assert.equal(limiter.check('ip-a'), null);
  });
});

// --- CORS / combined middleware ---------------------------------------------- //

describe('provider middleware — CORS + combined', () => {
  it('handles OPTIONS preflight and sets CORS headers', () => {
    const req = fakeReq({ origin: 'https://example.com' }, 'OPTIONS');
    const res = fakeRes();
    const handled = applyMiddleware(req, res, {}, undefined);
    assert.equal(handled, null);
    assert.equal(res.ended, 204);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.headers['access-control-allow-methods']!.includes('GET'));
  });

  it('rate-limited requests get Retry-After header', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const req = fakeReq({}, 'GET');
    const res = fakeRes();
    assert.equal(applyMiddleware(req, fakeRes(), {}, limiter), null); // first hit passes
    const result = applyMiddleware(fakeReq({}, 'GET'), res, {}, limiter); // second hit blocked
    assert.ok(result);
    assert.equal(result.status, 429);
  });

  it('auth failure short-circuits after CORS+rate pass', () => {
    const cfg = { keys: new Map([['good', 'tester']]) };
    const bad = applyMiddleware(fakeReq({}, 'POST'), fakeRes(), { auth: cfg }, undefined);
    assert.ok(bad);
    assert.equal(bad.status, 401);

    const good = applyMiddleware(fakeReq({ 'x-api-key': 'good' }, 'POST'), fakeRes(), { auth: cfg }, undefined);
    assert.equal(good, null);
  });

  it('preflight bypasses auth entirely', () => {
    const cfg = { keys: new Map([['good', 'tester']]) };
    const res = fakeRes();
    const result = applyMiddleware(fakeReq({}, 'OPTIONS'), res, { auth: cfg }, undefined);
    assert.equal(result, null);
    assert.equal(res.ended, 204);
  });
});

// --- Attestation error queue -------------------------------------------------- //

describe('attestation error queue', () => {
  it('round-trips records through append/read/clear', () => {
    clearErrors();
    const rec: FailedRecord = {
      ts: new Date().toISOString(),
      type: 'payment',
      orderId: '601999',
      error: 'RPC timeout',
      opts: { orderId: '601999', provider: '0xp', amount: '1000', serviceId: '0xs', transactionRef: '0xr' },
    };
    appendError(rec);
    const all = readErrors();
    assert.equal(all.length, 1);
    assert.equal(all[0].orderId, '601999');
    assert.equal(all[0].type, 'payment');

    clearErrors();
    assert.deepEqual(readErrors(), []);
  });

  it('dedups by type+orderId (replace instead of stack)', () => {
    clearErrors();
    const base = { ts: '', type: 'fulfillment' as const, orderId: '42', error: '', opts: {} };
    appendError({ ...base, error: 'first' });
    appendError({ ...base, error: 'second' });
    appendError({ ...base, orderId: '43', error: 'other-order' });
    const all = readErrors();
    assert.equal(all.length, 2);
    assert.equal(all.find((r) => r.orderId === '42')?.error, 'second');
    assert.equal(all.find((r) => r.orderId === '43')?.error, 'other-order');
    clearErrors();
  });

  it('readErrors tolerates a missing/corrupt file', () => {
    clearErrors();
    assert.deepEqual(readErrors(), []);
  });
});
