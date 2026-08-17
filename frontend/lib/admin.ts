import { NextResponse } from 'next/server';

const TOKEN_ENV = 'VEIL_ADMIN_TOKEN';

/**
 * Operator-gate for the destructive demo endpoints (kill / audit authorize /
 * audit revoke).
 *
 * In hardened runs, set VEIL_ADMIN_TOKEN and send `x-veil-admin: <token>` —
 * otherwise the call is rejected with 401. When the env var is unset the
 * endpoints remain open so the localhost demo works out of the box. This is
 * documented as a localhost-only guard: it is NOT a substitute for real auth in
 * a network-exposed deployment.
 */
export function requireAdmin(req: Request): NextResponse | null {
  const expected = process.env[TOKEN_ENV]?.trim();
  if (!expected) return null; // demo mode: open on localhost
  const presented = req.headers.get('x-veil-admin')?.trim();
  if (!presented || presented !== expected) {
    return NextResponse.json({ ok: false, error: 'admin token required (set VEIL_ADMIN_TOKEN)' }, { status: 401 });
  }
  return null;
}