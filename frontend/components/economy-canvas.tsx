'use client';

import { useEffect, useRef } from 'react';
import { CANVAS_NODES, OrderDetail, STAGE_NODE_INDEX, atomsUsd } from '../lib/veil-client';
import { Card } from './ui';

const W = 1020;
const H = 400;

const POS: Record<string, { x: number; y: number }> = {
  USER: { x: 70, y: 300 },
  'AI AGENT': { x: 200, y: 300 },
  PROVIDER: { x: 330, y: 300 },
  PAYMENT: { x: 445, y: 150 },
  'SOURCE CHAIN': { x: 580, y: 150 },
  ATTESTCOIN: { x: 715, y: 205 },
  CREDITCOIN: { x: 850, y: 285 },
  SETTLEMENT: { x: 955, y: 300 },
};

const PALETTE = ['#a3e635', '#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#38bdf8', '#f472b6'];
const INK = '#d8e2f0';
const MUT = '#7e8ca3';
const LINE = '#1d2a3f';
const BAD = '#f87171';

function polyline(): { pts: Array<{ x: number; y: number }>; cum: number[]; total: number } {
  const pts = CANVAS_NODES.map((n) => POS[n]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

function pointAt(pts: Array<{ x: number; y: number }>, cum: number[], t: number): { x: number; y: number } {
  const d = t * cum[cum.length - 1];
  for (let i = 1; i < cum.length; i++) {
    if (d <= cum[i]) {
      const segLen = cum[i] - cum[i - 1] || 1;
      const f = (d - cum[i - 1]) / segLen;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      };
    }
  }
  return pts[pts.length - 1];
}

interface OrderAnim {
  order: OrderDetail;
  color: string;
  tEnd: number;
  bad: boolean;
  badIdx: number;
}

function animFor(order: OrderDetail, color: string): OrderAnim {
  let tEnd = 0;
  let bad = false;
  let badIdx = 0;
  for (let i = 0; i < order.stages.length; i++) {
    const st = order.stages[i];
    if (st.status === 'REJECTED' || st.status === 'FAILED' || st.status === 'REFUNDED') {
      bad = true;
      badIdx = STAGE_NODE_INDEX[st.key] ?? 0;
      break;
    }
    if (st.status === 'VERIFIED' || st.status === 'SETTLED') {
      tEnd = Math.max(tEnd, (STAGE_NODE_INDEX[st.key] ?? 0) / (CANVAS_NODES.length - 1));
    }
  }
  return { order, color, tEnd, bad: bad as boolean, badIdx };
}

export function EconomyCanvas({ orders }: { orders: OrderDetail[] }): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const { pts, cum } = polyline();
    let raf = 0;
    const now = performance.now();

    const draw = (time: number): void => {
      ctx.clearRect(0, 0, W, H);

      // faint grid
      ctx.strokeStyle = 'rgba(29,42,63,0.35)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y <= H; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // base edges
      for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }

      // nodes
      CANVAS_NODES.forEach((n, i) => {
        const p = POS[n];
        ctx.fillStyle = '#0d141f';
        ctx.strokeStyle = i === 2 ? '#34d399' : i === 5 ? '#38bdf8' : i === 6 ? '#a78bfa' : LINE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(p.x - 54, p.y - 16, 108, 32, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n, p.x, p.y);
        ctx.fillStyle = MUT;
        ctx.font = '700 8px monospace';
        ctx.fillText(String(i + 1), p.x, p.y + 26);
      });

      const anims = ordersRef.current.map((o, i) => animFor(o, PALETTE[i % PALETTE.length]));

      // order paths + pulses
      for (const a of anims) {
        const tCap = a.bad ? a.badIdx / (CANVAS_NODES.length - 1) : a.tEnd;
        ctx.save();

        // traversed path (real progress only)
        if (tCap > 0.001) {
          ctx.strokeStyle = a.bad ? BAD : a.color;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 5]);
          for (let i = 1; i < pts.length; i++) {
            const tEnd = cum[i - 1] / cum[cum.length - 1];
            if (tEnd > tCap + 0.002) break;
            ctx.beginPath();
            ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
            ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }

        // travelling packet animates only within these real bounds
        const phase = ((time - now) / 2600 + a.order.createdAt % 1000 * 0.001) % 1;
        const eased = phase * phase * (3 - 2 * phase);
        const t = tCap <= 0.001 ? 0.001 : tCap * eased;
        const p = pointAt(pts, cum, Math.max(0.001, t));
        const glow = a.bad ? BAD : t < a.tEnd - 0.005 ? a.color : a.color;
        ctx.globalAlpha = 0.95;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 14;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, t < a.tEnd - 0.002 && !a.bad ? 4 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // packet labels on the far side
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-line px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-sm font-semibold text-ink">Agent Economy Pipeline</div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-mut">
            {PaletteKey().map(([label, color], i) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <canvas ref={ref} style={{ width: W, height: H, minWidth: W }} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-line px-6 py-3 text-[11px] text-mut">
        <span>
          Path: USER → AI AGENT → PROVIDER → PAYMENT → SOURCE CHAIN → ATTESTCOIN → CREDITCOIN → SETTLEMENT
        </span>
        <span className="font-mono">
          {orders.length === 0
            ? 'no transactions yet'
            : `${orders.filter((o) => o.ok).length}/${orders.length} settled`}
        </span>
      </div>
      <div className="px-6 pb-4 text-[11px] leading-relaxed text-mut">
        Visualized state is the <span className="text-ink">real ledger state</span> behind each transaction. The pulse
        never moves past a stage the rail has not actually reached. Attestation stages are mirrored in the demo
        SettlementLedger; no live ASC submission is claimed.
      </div>
    </div>
  );
}

function PaletteKey(): Array<[string, string]> {
  return [
    ['live', PALETTE[0]],
    ['settled', PALETTE[1]],
    ['refused', BAD],
  ];
}