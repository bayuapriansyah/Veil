'use client';

import dynamic from 'next/dynamic';
import { Reveal } from './reveal';
import { useLive } from './use-live';

const EconomyCanvas = dynamic(() => import('../economy-canvas').then((m) => m.EconomyCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-card border border-line bg-panel text-sm text-mut">
      loading pipeline…
    </div>
  ),
});

export function CanvasSection(): React.ReactElement {
  const { orders } = useLive(1500);
  return (
    <section id="canvas" className="border-y border-line bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            The whole pipeline, in motion.
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-10">
            <EconomyCanvas orders={orders} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}