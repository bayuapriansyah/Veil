import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';
import { requireAdmin } from '@/lib/admin';

// Grant an auditor access. Destructive/privileged — gated by VEIL_ADMIN_TOKEN
// when configured (see lib/admin.ts).
export async function POST(req: Request): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { auditor?: string };
    if (!body.auditor) return NextResponse.json({ ok: false, error: 'auditor is required' }, { status: 400 });
    const rt = await getRuntime();
    const acct = rt.authorize(body.auditor);
    return NextResponse.json({ ok: true, auditor: acct });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}