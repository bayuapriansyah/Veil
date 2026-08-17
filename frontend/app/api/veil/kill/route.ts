import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';
import { requireAdmin } from '@/lib/admin';

// Kill switch: revokes every mandate on every provider ledger and refuses
// further purchases. Mirrors the operator's real MandateManager revoke.
// Destructive — gated by VEIL_ADMIN_TOKEN when configured (see lib/admin.ts).
export async function POST(req: Request): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const rt = await getRuntime();
    await rt.kill();
    return NextResponse.json({ ok: true, state: rt.state() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}