import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { task?: string };
    const task = (body.task ?? '').trim();
    if (!task) return NextResponse.json({ ok: false, error: 'task is required' }, { status: 400 });
    const rt = await getRuntime();
    const result = await rt.purchase(task);
    return NextResponse.json({ ok: result.ok, orderId: result.orderId, reason: result.reason, onchainRecordTxHash: result.onchainRecordTxHash });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}