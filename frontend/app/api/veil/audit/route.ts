import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { getRuntime } from '@/lib/veil-runtime';

// Public audit register: ONLY txId / commitment / status banners / encrypted
// marker leave the vault. The handler never decrypts.
export async function GET(): Promise<NextResponse> {
  try {
    const rt = await getRuntime();
    const txs = rt.auditTxs();
    return NextResponse.json({ ok: true, txCount: txs.length, txs, auditors: rt.auditors() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}