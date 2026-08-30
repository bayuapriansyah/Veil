import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';

// Demonstrative: an UNAUTHORIZED auditor attempt that the vault must refuse.
// Signs with a "borrowed" key the operator never authorized. Proves the
// signed-request path only opens for actually-authorized addresses.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { txId?: string };
    if (!body.txId) return NextResponse.json({ ok: false, error: 'txId is required' }, { status: 400 });
    const rt = await getRuntime();
    const result = await rt.attemptUnauthorized(body.txId);
    return NextResponse.json({ ok: result.ok, disclosure: result.data, error: result.error });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}