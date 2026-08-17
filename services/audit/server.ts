/**
 * VEIL privacy & audit HTTP server.
 *
 *   PUBLIC (never decrypts):
 *     GET  /api/audit/txs                 public transaction list
 *     GET  /api/audit/tx/:txId            public transaction view
 *
 *   AUDITOR (signed AuditAccess, ECRECOVER + vault authorization + nonce guard):
 *     GET  /api/audit/disclosure/:txId?fields=…   selective / full disclosure
 *     GET  /api/audit/evidence/:txId              evidence bundle
 *
 *   OPERATOR (x-operator header):
 *     POST /api/audit/vault               record a transaction (sensitive data encrypted at rest)
 *     POST /api/audit/authorize           grant an auditor access
 *     POST /api/audit/revoke              revoke an auditor
 *
 * Public endpoints IGNORE credentials by design: even a fully authorized
 * auditor only ever receives the public view from them — the private data is
 * served exclusively by the signed auditor endpoints.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { AuditVault } from './vault';
import { AuditAccessRequest, ProtectedData, PublicTxView } from './types';
import { verifyAuditAccess, signAuditAccess } from './signer';
import { loadVaultKey } from './crypto';

export interface AuditServerOptions {
  operatorAddress: string;
  /** Overrides VEIL_VAULT_KEY / VEIL_VAULT_KEY_FILE resolution (tests/demo). */
  vaultKey?: Buffer;
}

export interface AuditServerHandle {
  vault: AuditVault;
  keySource: string;
  operatorAddress: string;
}

export function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

export function decodeBase64Json<T>(header: string | undefined): T | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function createAuditServer(opts: AuditServerOptions) {
  const keyResolved = opts.vaultKey ? undefined : loadVaultKey();
  const masterKey = opts.vaultKey ?? (keyResolved as { key: Buffer }).key;
  const keySource = opts.vaultKey ? 'provided' : (keyResolved as { source: string }).source;
  const vault = new AuditVault(masterKey, keySource);
  const operator = opts.operatorAddress.toLowerCase();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const [path, query] = url.split('?');
    const params = query ? new URLSearchParams(query) : new URLSearchParams();

    if (req.method === 'GET' && path === '/api/audit/health') {
      return json(res, 200, { ok: true, keySource, txCount: vault.txCount, operator: opts.operatorAddress });
    }

    // Public transaction view (never decrypts).
    if (req.method === 'GET' && path === '/api/audit/txs') {
      return json(res, 200, { transactions: vault.list() });
    }
    if (req.method === 'GET' && path.startsWith('/api/audit/tx/')) {
      const txId = path.split('/').pop() ?? '';
      const view = vault.publicView(txId);
      if (!view) return json(res, 404, { error: 'TransactionNotKnown' });
      return json(res, 200, view);
    }

    // Auditor endpoints (signed + authorized + nonce-guarded).
    if (req.method === 'GET' && path.startsWith('/api/audit/disclosure/')) {
      const txId = path.split('/').pop() ?? '';
      const auth = verifySigned(req, path, vault);
      if (!auth.ok) return json(res, auth.status, { error: auth.error });
      const fields = params.get('fields')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
      const result = vault.disclose(txId, auth.auditor!, { fields: fields.length ? fields : undefined });
      if (result === undefined) return json(res, 404, { error: 'TransactionNotKnown' });
      return json(res, 200, { txId, auditor: auth.auditor, fields: fields.length ? fields : undefined, protectedData: result });
    }
    if (req.method === 'GET' && path.startsWith('/api/audit/evidence/')) {
      const txId = path.split('/').pop() ?? '';
      const auth = verifySigned(req, path, vault);
      if (!auth.ok) return json(res, auth.status, { error: auth.error });
      const bundle = vault.evidenceBundle(txId, auth.auditor!);
      if (bundle === undefined) return json(res, 404, { error: 'TransactionNotKnown' });
      return json(res, 200, { txId, auditor: auth.auditor, evidence: bundle });
    }

    // Operator-only.
    if (req.method === 'POST' && path.startsWith('/api/audit/')) {
      if (!isOperator(req, operator)) {
        return json(res, 403, { error: 'Unauthorized: operator header required' });
      }
      if (path === '/api/audit/vault') {
        return readBody(req, res, (body) => {
          const protectedData = body.protectedData as ProtectedData;
          const { record, view } = vault.recordTransaction({
            txId: body.txId,
            commitment: body.commitment,
            verificationStatus: body.verificationStatus ?? 'pending',
            policyStatus: body.policyStatus ?? 'unknown',
            settlementStatus: body.settlementStatus ?? 'none',
            protectedData,
            createdAt: body.createdAt,
          });
          return json(res, 201, { txId: record.txId, commitment: record.commitment, record: view, sealed: record.protected });
        });
      }
      if (path === '/api/audit/authorize') {
        return readBody(req, res, (body) => {
          const account = vault.authorize(body.auditor, { scope: body.scope });
          return json(res, 200, { auditor: account.auditor, authorized: account.authorized, scope: account.scope });
        });
      }
      if (path === '/api/audit/revoke') {
        return readBody(req, res, (body) => {
          const account = vault.revoke(body.auditor);
          if (!account) return json(res, 404, { error: 'AuditorUnknown' });
          return json(res, 200, { auditor: account.auditor, authorized: false, revokedAt: account.revokedAt });
        });
      }
    }

    return json(res, 404, { error: 'not found' });
  });

  (server as unknown as { __auditServerOpts?: AuditServerHandle }).__auditServerOpts = {
    vault,
    keySource,
    operatorAddress: opts.operatorAddress,
  };
  return server;
}

export async function startAuditServer(
  opts: AuditServerOptions,
  port = 0,
): Promise<{ server: ReturnType<typeof createAuditServer>; port: number; vault: AuditVault; keySource: string; close: () => Promise<void> }> {
  const server = createAuditServer(opts);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address() as AddressInfo;
  const handle = (server as unknown as { __auditServerOpts: AuditServerHandle }).__auditServerOpts;
  return {
    server,
    port: address.port,
    vault: handle.vault,
    keySource: handle.keySource,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ------------------------------------------------------------------------- //

interface AuthCheck {
  ok: boolean;
  auditor?: string;
  status: number;
  error?: string;
}

function verifySigned(req: IncomingMessage, path: string, vault: AuditVault): AuthCheck {
  const encoded = headerStr(req.headers['x-audit-auth'] ?? req.headers['x-audit-access']);
  if (!encoded) return { ok: false, status: 403, error: 'signed AuditAccess request required (X-Audit-Auth)' };
  const auditReq = decodeBase64Json<AuditAccessRequest>(encoded);
  if (!auditReq) return { ok: false, status: 400, error: 'malformed X-Audit-Auth' };
  const txId = path.split('/').pop() ?? '';
  const verified = verifyAuditAccess(auditReq, {
    expectedResource: path,
    expectedTxId: txId,
    isAuthorized: (auditor) => vault.isAuthorized(auditor, txId),
  });
  if (!verified.ok || !verified.auditor) {
    return { ok: false, status: 403, error: `disclosure denied: ${verified.error}` };
  }
  if (!vault.useNonce(verified.auditor, auditReq.nonce)) {
    return { ok: false, status: 403, error: 'nonce replay detected' };
  }
  return { ok: true, auditor: verified.auditor, status: 200 };
}

function isOperator(req: IncomingMessage, operator: string): boolean {
  const caller = headerStr(req.headers['x-operator']);
  return Boolean(caller) && caller!.toLowerCase() === operator;
}

function readBody(req: IncomingMessage, res: ServerResponse, fn: (body: Record<string, any>) => void): void {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}') as Record<string, any>;
      fn(parsed);
    } catch (e: any) {
      return json(res, 400, { error: e?.message ?? 'bad request body' });
    }
  });
}

function json(res: ServerResponse, status: number, body: unknown): ServerResponse {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return res;
}

function headerStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export { signAuditAccess };
export type { PublicTxView };