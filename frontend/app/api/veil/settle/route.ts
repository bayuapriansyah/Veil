import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';
import { trySettleOrder, settlementEnabled } from '../../../../services/attestation/settle';
import { loadConfig, creditcoinProvider } from '../../../../services/attestation/config';

/**
 * Sealed settlement: reads the preimage from the vault, verifies the
 * commitment, and executes settlement on Creditcoin.
 *
 * POST /api/veil/settle
 * Body: { orderId: string, dryRun?: boolean }
 *
 * When dryRun=true, returns the vault preimage without settling (used by
 * the worker to read the preimage before calling trySettleOrder).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { orderId?: string; dryRun?: boolean };
    if (!body.orderId) {
      return NextResponse.json({ ok: false, error: 'orderId is required' }, { status: 400 });
    }

    const rt = await getRuntime();
    const txId = `veil-${body.orderId}`;
    const preimage = await rt.settlementPreimage(txId);
    if (!preimage) {
      return NextResponse.json({ ok: false, error: `vault record not found for ${txId}` }, { status: 404 });
    }

    if (body.dryRun) {
      return NextResponse.json({ ok: true, preimage });
    }

    if (!settlementEnabled()) {
      return NextResponse.json({ ok: false, error: 'settlement stack not deployed' }, { status: 503 });
    }

    const config = loadConfig();
    const ccProvider = creditcoinProvider(config);
    const result = await trySettleOrder(config, ccProvider, body.orderId, preimage);
    ccProvider.destroy();

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    if (result.done) {
      await rt.attachSettlement(txId, {
        settlementStatus: 'settled',
        settlementTx: result.settlementTxHash,
        escrowTx: result.escrowTxHash,
        mandateId: result.mandateId,
      });
    }

    return NextResponse.json({
      ok: true,
      done: result.done,
      mandateId: result.mandateId,
      escrowTxHash: result.escrowTxHash,
      settlementTxHash: result.settlementTxHash,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
