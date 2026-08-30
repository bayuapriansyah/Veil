import { NextResponse } from 'next/server';
import { getRuntime } from '@/lib/veil-runtime';
import { ToolProgress } from '../../../../../../services/procurement/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const encoder = new TextEncoder();
  const body = (await req.json().catch(() => ({}))) as { task?: string };
  const task = (body.task ?? '').trim();
  if (!task) return NextResponse.json({ ok: false, error: 'task is required' }, { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const rt = await getRuntime();
        const result = await rt.purchase(task, (progress: ToolProgress) => {
          send('progress', progress);
        });
        send('done', result);
      } catch (e) {
        send('error', { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
