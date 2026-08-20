import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';

/**
 * Worker callback: record the live attestation fact once a proof has been
 * submitted to the AttestationReceiver ASC on Creditcoin. Public-only update
 * (tx hashes are public chain data); the sealed vault payload never changes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { txId?: string; attestationStatus?: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string };
    if (!body.txId || (body.attestationStatus !== 'proving' && body.attestationStatus !== 'verified')) {
      return NextResponse.json({ ok: false, error: 'txId and attestationStatus are required' }, { status: 400 });
    }
    const rt = await getRuntime();
    const res = rt.attachAttestation(body.txId, { attestationStatus: body.attestationStatus, attestationTx: body.attestationTx, sourceTx: body.sourceTx });
    return NextResponse.json(res.ok ? { ok: true } : { ok: false, error: res.error }, { status: res.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}