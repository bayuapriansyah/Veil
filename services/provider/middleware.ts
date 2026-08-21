/**
 * VEIL provider server middleware — API key auth, rate limiting, CORS.
 *
 * These are applied at the HTTP server level (not x402 payment level).
 * The x402 payment gate remains the primary access control; middleware
 * provides operational hardening for production deployments.
 */
import { IncomingMessage, ServerResponse } from 'node:http';

// --- API Key Authentication ------------------------------------------------ //

export interface AuthConfig {
  /** Map of valid API keys -> human-readable names. */
  keys: Map<string, string>;
}

/**
 * Build an AuthConfig from env: PROVIDER_API_KEYS="key1:name1,key2:name2"
 * If the env var is empty/missing, auth is disabled (all requests pass).
 */
export function loadAuthConfig(): AuthConfig | null {
  const raw = process.env.PROVIDER_API_KEYS;
  if (!raw || !raw.trim()) return null;
  const keys = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const [key, name] = entry.split(':');
    if (key?.trim()) keys.set(key.trim(), name?.trim() ?? key.trim());
  }
  return keys.size > 0 ? { keys } : null;
}

/**
 * Verify the request carries a valid API key in `X-API-Key` header.
 * Returns null on success, or { status, error } on failure.
 */
export function verifyApiKey(
  req: IncomingMessage,
  config: AuthConfig | null,
): { status: number; error: string } | null {
  if (!config) return null; // auth disabled
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || !config.keys.has(key)) {
    return { status: 401, error: 'invalid or missing X-API-Key' };
  }
  return null;
}

// --- Rate Limiting --------------------------------------------------------- //

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  /** Max requests per window per IP (default: 100). */
  maxRequests: number;
  /** Window duration in milliseconds (default: 60_000 = 1 minute). */
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;

  constructor(config?: Partial<RateLimitConfig>) {
    this.maxRequests = config?.maxRequests ?? 100;
    this.windowMs = config?.windowMs ?? 60_000;
  }

  /** Check + record a hit. Returns null on success, or { status, error, retryAfterMs } on limit. */
  check(ip: string): { status: number; error: string; retryAfterMs: number } | null {
    const now = Date.now();
    const entry = this.hits.get(ip);

    if (!entry || now > entry.resetAt) {
      this.hits.set(ip, { count: 1, resetAt: now + this.windowMs });
      return null;
    }

    entry.count++;
    if (entry.count > this.maxRequests) {
      const retryAfterMs = entry.resetAt - now;
      return {
        status: 429,
        error: `rate limit exceeded — retry after ${Math.ceil(retryAfterMs / 1000)}s`,
        retryAfterMs,
      };
    }
    return null;
  }

  /** Periodic cleanup of expired entries. */
  sweep(): void {
    const now = Date.now();
    for (const [ip, entry] of this.hits) {
      if (now > entry.resetAt) this.hits.delete(ip);
    }
  }
}

// --- CORS ------------------------------------------------------------------ //

export interface CorsConfig {
  /** Allowed origins (default: *). */
  origins: string[];
  /** Allowed methods (default: GET, POST, OPTIONS). */
  methods: string[];
  /** Allowed headers (default: Content-Type, X-PAYMENT, X-Operator, X-API-Key). */
  headers: string[];
  /** Max age for preflight cache in seconds (default: 86400). */
  maxAge: number;
}

const DEFAULT_CORS: CorsConfig = {
  origins: ['*'],
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: ['Content-Type', 'X-PAYMENT', 'X-Operator', 'X-API-Key', 'Payment-Signature'],
  maxAge: 86400,
};

/**
 * Apply CORS headers to a response. Returns true if this was a preflight
 * (OPTIONS) request that was handled (caller should return).
 */
export function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  config?: Partial<CorsConfig>,
): boolean {
  const cfg = { ...DEFAULT_CORS, ...config };
  const origin = req.headers.origin;

  if (cfg.origins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && cfg.origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', cfg.methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', cfg.headers.join(', '));
  res.setHeader('Access-Control-Max-Age', String(cfg.maxAge));

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

// --- Combined middleware --------------------------------------------------- //

export interface MiddlewareConfig {
  auth?: AuthConfig | null;
  rateLimit?: RateLimitConfig;
  cors?: Partial<CorsConfig>;
}

/**
 * Apply all middleware to an incoming request.
 * Returns null if request is allowed, or { status, headers, error } if rejected.
 */
export function applyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  config: MiddlewareConfig,
  limiter?: RateLimiter,
): { status: number; headers: Record<string, string>; error: string } | null {
  // 1. CORS (handles preflight)
  if (handleCors(req, res, config.cors)) {
    return null; // preflight handled, caller should return
  }

  // 2. Rate limit
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';
  if (limiter) {
    const rateResult = limiter.check(ip);
    if (rateResult) {
      res.setHeader('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return { status: rateResult.status, headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) }, error: rateResult.error };
    }
  }

  // 3. API key auth
  if (config.auth) {
    const authResult = verifyApiKey(req, config.auth);
    if (authResult) {
      return { status: authResult.status, headers: {}, error: authResult.error };
    }
  }

  return null;
}
