import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { getRuntime } from '@/lib/veil-runtime';

export async function GET(): Promise<NextResponse> {
  try {
    const rt = await getRuntime();
    return NextResponse.json({ ok: true, orders: rt.ordersList() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}