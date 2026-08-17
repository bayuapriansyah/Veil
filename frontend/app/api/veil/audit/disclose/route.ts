import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';

// Authorized auditor selective disclosure. The runtime signs a real EIP-712
// AuditAccess, ECRECOVER-verifies it, consumes the nonce and lets the VAULT
// decide (addressed scope check) which protected fields to reveal.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { txId?: string; fields?: string[] };
    if (!body.txId) return NextResponse.json({ ok: false, error: 'txId is required' }, { status: 400 });
    const rt = await getRuntime();
    const result = rt.discloseAuditor(body.txId, body.fields);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? 'disclosure failed' }, { status: 403 });
    return NextResponse.json({ ok: true, data: result.data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}