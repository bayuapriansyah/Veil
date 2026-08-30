import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';

/**
 * Worker callback: record the live attestation fact once a proof has been
 * submitted to the AttestationReceiver ASC on Creditcoin. Public-only update
 * (tx hashes are public chain data); the sealed vault payload never changes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      txId?: string;
      attestationStatus?: 'proving' | 'verified';
      attestationTx?: string;
      sourceTx?: string;
      zkReceiptStatus?: 'none' | 'proving' | 'verified';
      settlement?: { status?: string; txHash?: string; escrowTxHash?: string; mandateId?: string };
    };
    if (!body.txId || (body.attestationStatus !== 'proving' && body.attestationStatus !== 'verified')) {
      return NextResponse.json({ ok: false, error: 'txId and attestationStatus are required' }, { status: 400 });
    }
    const rt = await getRuntime();
    const res = await rt.attachAttestation(body.txId, { attestationStatus: body.attestationStatus, attestationTx: body.attestationTx, sourceTx: body.sourceTx, zkReceiptStatus: body.zkReceiptStatus });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 404 });
    }
    if (body.settlement && body.settlement.status === 'settled') {
      const s = await rt.attachSettlement(body.txId, {
        settlementStatus: 'settled',
        settlementTx: body.settlement.txHash,
        escrowTx: body.settlement.escrowTxHash,
        mandateId: body.settlement.mandateId,
      });
      if (!s.ok) {
        return NextResponse.json({ ok: false, error: s.error }, { status: 404 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}