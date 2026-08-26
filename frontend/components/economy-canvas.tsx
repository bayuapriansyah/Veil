'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CheckCircle,
  Coin,
  CreditCard,
  Fingerprint,
  Person,
  Robot,
  Stack,
  Storefront,
  Crosshair,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { CANVAS_NODES, OrderDetail, STAGE_NODE_INDEX, atomsUsd, useVeilMode } from '../lib/veil-client';

const NODE_W = 190;
const NODE_H = 78;

const NODE_META: Record<string, { icon: Icon; hint: string }> = {
  USER: { icon: Person, hint: 'operator' },
  'AI AGENT': { icon: Robot, hint: 'deterministic planner' },
  PROVIDER: { icon: Storefront, hint: 'x402 rail' },
  PAYMENT: { icon: CreditCard, hint: 'escrow lock' },
  'SOURCE CHAIN': { icon: Stack, hint: 'sepolia' },
  ATTESTCOIN: { icon: Fingerprint, hint: 'proof builder' },
  CREDITCOIN: { icon: Coin, hint: 'settlement l1' },
  SETTLEMENT: { icon: CheckCircle, hint: 'escrow release' },
};

const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  USER: { x: 0, y: 140 },
  'AI AGENT': { x: 240, y: 80 },
  PROVIDER: { x: 480, y: 140 },
  PAYMENT: { x: 720, y: 200 },
  'SOURCE CHAIN': { x: 960, y: 200 },
  ATTESTCOIN: { x: 1200, y: 140 },
  CREDITCOIN: { x: 1440, y: 80 },
  SETTLEMENT: { x: 1680, y: 140 },
};

const PALETTE = ['#3fb950', '#7f8690', '#2ea043', '#56d364', '#b8bdc4', '#3fb950', '#949aa4'];
const OK = '#3fb950';
const BAD = '#f85149';

type Tone = 'ok' | 'bad' | 'pending';

interface VeilNodeData extends Record<string, unknown> {
  label: string;
  index: string;
  tone: Tone;
  hint: string;
  count: number;
}

type VeilNode = Node<VeilNodeData, 'veilNode'>;

function furthestVerified(order: OrderDetail | null): number {
  if (!order) return 0;
  let max = 0;
  for (const st of order.stages) {
    if (st.status === 'VERIFIED' || st.status === 'SETTLED') {
      max = Math.max(max, STAGE_NODE_INDEX[st.key] ?? 0);
    }
  }
  return max;
}

function nodeToneFor(order: OrderDetail | null, i: number): Tone {
  if (!order) return 'pending';
  const entry = Object.entries(STAGE_NODE_INDEX).find(([, v]) => v === i);
  if (entry) {
    const st = order.stages.find((s) => s.key === entry[0]);
    if (st && (st.status === 'FAILED' || st.status === 'REJECTED' || st.status === 'REFUNDED')) return 'bad';
  }
  return furthestVerified(order) >= i ? 'ok' : 'pending';
}

function edgeStateFor(order: OrderDetail | null, fromIndex: number): Tone {
  const toIndex = fromIndex + 1;
  const entry = Object.entries(STAGE_NODE_INDEX).find(([, v]) => v === toIndex);
  let badHere = false;
  if (order && entry) {
    const st = order.stages.find((s) => s.key === entry[0]);
    badHere = !!st && (st.status === 'FAILED' || st.status === 'REJECTED' || st.status === 'REFUNDED');
  }
  if (badHere && furthestVerified(order) < toIndex) return 'bad';
  if (order && furthestVerified(order) >= toIndex) return 'ok';
  return 'pending';
}

function nodeCountAt(orders: OrderDetail[], i: number): number {
  return orders.filter((o) => furthestVerified(o) >= i).length;
}

function aggregateTone(orders: OrderDetail[], i: number, edge: boolean): Tone {
  let hasOk = false;
  let hasBad = false;
  for (const o of orders) {
    const t = edge ? edgeStateFor(o, i) : nodeToneFor(o, i);
    if (t === 'ok') hasOk = true;
    if (t === 'bad') hasBad = true;
  }
  if (hasOk) return 'ok';
  if (hasBad) return 'bad';
  return 'pending';
}

function buildDefaultNodes(): VeilNode[] {
  return CANVAS_NODES.map((name, i) => ({
    id: name,
    type: 'veilNode',
    position: DEFAULT_POSITIONS[name],
    data: {
      label: name,
      index: String(i + 1).padStart(2, '0'),
      tone: 'pending' as Tone,
      hint: NODE_META[name].hint,
      count: 0,
    },
  }));
}

function applyOrdersToNodes(prev: VeilNode[], orders: OrderDetail[]): VeilNode[] {
  return prev.map((n) => {
    const i = CANVAS_NODES.indexOf(n.id as (typeof CANVAS_NODES)[number]);
    const data = { ...n.data, tone: aggregateTone(orders, i, false), count: nodeCountAt(orders, i) };
    return { ...n, data };
  });
}

function buildEdges(orders: OrderDetail[]): Edge[] {
  return CANVAS_NODES.slice(0, -1).map((name, i) => {
    const tone = aggregateTone(orders, i, true);
    return {
      id: `${name}->${CANVAS_NODES[i + 1]}`,
      source: name,
      target: CANVAS_NODES[i + 1],
      type: 'smoothstep',
      animated: tone === 'ok',
      className: `veil-edge veil-edge--${tone}`,
    };
  });
}

const nodeTypesMemo = { veilNode: VeilNodeCard };

function VeilNodeCard({ data }: NodeProps<VeilNode>): React.ReactElement {
  const IconComp = NODE_META[data.label].icon;
  return (
    <div className={`veil-node veil-node--${data.tone}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2 text-ink">
          <IconComp size={16} weight="regular" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-mut/80">{data.index}</div>
          <div className="truncate text-sm font-semibold text-ink">{data.label}</div>
        </div>
        <span className={`status-dot status-dot--${data.tone}`} />
      </div>
      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
        <span className="text-[11px] text-mut">{data.hint}</span>
        {data.count > 0 && (
          <span className="font-mono text-[10px] text-mut/70">
            {data.count} order{data.count > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
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

function FlowOverlay({ orders, wrapRef }: { orders: OrderDetail[]; wrapRef: React.RefObject<HTMLDivElement | null> }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const reduceRef = useRef(false);
  const { getNodes, getViewport } = useReactFlow();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    reduceRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef]);

  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    const start = performance.now();

    const draw = (time: number): void => {
      ctx.clearRect(0, 0, size.w, size.h);
      const ordersNow = ordersRef.current;
      if (ordersNow.length > 0) {
        const vp = getViewport();
        const nodes = getNodes();
        const pos = new Map<string, { x: number; y: number }>();
        for (const n of nodes) {
          const px = n.position.x + (n.measured?.width ?? NODE_W) / 2;
          const py = n.position.y + (n.measured?.height ?? NODE_H) / 2;
          pos.set(n.id, { x: px * vp.zoom + vp.x, y: py * vp.zoom + vp.y });
        }
        const pts = CANVAS_NODES.map((name) => pos.get(name) ?? { x: 0, y: 0 });
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        }
        const total = cum[cum.length - 1] || 1;

        ordersNow.forEach((order, idx) => {
          let tCap = furthestVerified(order) / (CANVAS_NODES.length - 1);
          let bad = false;
          let badIdx = 0;
          for (let i = 0; i < order.stages.length; i++) {
            const st = order.stages[i];
            if (st.status === 'REJECTED' || st.status === 'FAILED' || st.status === 'REFUNDED') {
              bad = true;
              badIdx = STAGE_NODE_INDEX[st.key] ?? 0;
              break;
            }
          }
          if (bad) tCap = badIdx / (CANVAS_NODES.length - 1);
          const color = bad ? BAD : PALETTE[idx % PALETTE.length];
          const phase = reduceRef.current ? 0.5 : ((time - start) / 2600 + (order.createdAt % 1000) * 0.001) % 1;
          const eased = phase * phase * (3 - 2 * phase);
          const t = tCap <= 0.001 ? 0.001 : tCap * eased;
          const p = pointAt(pts, cum, Math.max(0.001, t));
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, t < tCap - 0.002 && !bad ? 4.5 : 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        });
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, getNodes, getViewport]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

function CanvasToolbar({ orders, lock, onLock }: { orders: OrderDetail[]; lock: boolean; onLock: (v: boolean) => void }): React.ReactElement {
  const { zoomIn, zoomOut, fitView, setNodes } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const settled = orders.filter((o) => o.ok).length;

  const reset = (): void => {
    setNodes(buildDefaultNodes());
    fitView({ padding: 0.15, duration: 300 });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2.5">
        <div className="font-mono text-sm font-semibold text-ink">Agent Economy Pipeline</div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ok">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          live
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-3 font-mono text-[11px] text-mut sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ok" /> live
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ok/50" /> settled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-bad" /> refused
          </span>
        </span>
        <button className="btn-muted !px-2.5 !py-1.5 font-mono text-[11px]" onClick={() => onLock(!lock)} aria-pressed={lock}>
          {lock ? 'Unlock' : 'Lock'}
        </button>
        <button className="btn-muted !px-2.5 !py-1.5 font-mono text-[11px]" onClick={reset}>
          Reset layout
        </button>
        <button className="btn-muted !px-2.5 !py-1.5 font-mono text-[11px]" onClick={() => void zoomOut({ duration: 200 })} aria-label="Zoom out">
          −
        </button>
        <span className="w-12 text-center font-mono text-[11px] text-mut">{Math.round(zoom * 100)}%</span>
        <button className="btn-muted !px-2.5 !py-1.5 font-mono text-[11px]" onClick={() => void zoomIn({ duration: 200 })} aria-label="Zoom in">
          +
        </button>
        <button className="btn-muted !px-2.5 !py-1.5 font-mono text-[11px]" onClick={() => void fitView({ padding: 0.15, duration: 300 })} aria-label="Fit view">
          <Crosshair size={13} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function BlocksPalette(): React.ReactElement {
  const { setCenter } = useReactFlow();
  const groups: Array<{ label: string; items: string[] }> = [
    { label: 'Actors', items: ['USER', 'AI AGENT', 'PROVIDER'] },
    { label: 'Ledger', items: ['PAYMENT', 'SOURCE CHAIN', 'SETTLEMENT'] },
    { label: 'Attestation', items: ['ATTESTCOIN', 'CREDITCOIN'] },
  ];
  return (
    <div className="flex shrink-0 flex-col gap-4 border-t border-line/70 p-4 sm:border-t-0 sm:border-r sm:p-5">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-mut/60">{g.label}</div>
          <div className="flex flex-wrap gap-1.5 sm:flex-col">
            {g.items.map((name) => {
              const IconComp = NODE_META[name].icon;
              const i = CANVAS_NODES.indexOf(name as (typeof CANVAS_NODES)[number]);
              return (
                <button
                  key={name}
                  onClick={() => {
                    const p = DEFAULT_POSITIONS[name];
                    setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, { zoom: 1, duration: 350 });
                  }}
                  className="flex items-center gap-2 rounded-lg border border-line bg-panel2/70 px-2.5 py-1.5 text-left transition-colors hover:border-ok/40 hover:bg-panel2"
                  title={`Focus ${name}`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-panel text-ink">
                    <IconComp size={13} />
                  </span>
                  <span className="font-mono text-[11px] text-mut transition-colors hover:text-ink">
                    {String(i + 1).padStart(2, '0')} · {name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CanvasStage({ orders }: { orders: OrderDetail[] }): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<VeilNode[]>(() => buildDefaultNodes());
  const [lock, setLock] = useState(false);

  const onNodesChange = useCallback((changes: NodeChange<VeilNode>[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onInit = useCallback((instance: { fitView: (o?: { padding?: number }) => void }): void => {
    instance.fitView({ padding: 0.15 });
  }, []);

  useEffect(() => {
    setNodes((prev) => applyOrdersToNodes(prev, orders));
  }, [orders]);

  const edges = useMemo(() => buildEdges(orders), [orders]);
  const nodeTypesMemo = useMemo(() => ({ veilNode: VeilNodeCard }), []);

  return (
    <div className="flex flex-col sm:flex-row">
      <BlocksPalette />
      <div ref={wrapRef} className="relative h-[440px] flex-1 sm:h-[520px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypesMemo}
          onInit={onInit}
          nodesDraggable={!lock}
          minZoom={0.25}
          maxZoom={2}
          panOnDrag
          selectionOnDrag={false}
          zoomOnDoubleClick={false}
          className="veil-flow"
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="#26262b" />
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            bgColor="#0e0e11"
            maskColor="rgba(12, 12, 14, 0.6)"
            maskStrokeColor="#3a3a41"
            nodeColor={(n) => {
              const tone = (n.data as unknown as VeilNodeData | undefined)?.tone;
              if (tone === 'ok') return OK;
              if (tone === 'bad') return BAD;
              return '#26262b';
            }}
          />
        </ReactFlow>
        <FlowOverlay orders={orders} wrapRef={wrapRef} />
      </div>
    </div>
  );
}

export function EconomyCanvas({ orders }: { orders: OrderDetail[] }): React.ReactElement {
  const [lock, setLock] = useState(false);
  const mode = useVeilMode();
  const settled = orders.filter((o) => o.ok).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
      <ReactFlowProvider>
        <CanvasToolbar orders={orders} lock={lock} onLock={setLock} />
        <CanvasStage orders={orders} />
        <div className="flex flex-wrap justify-between gap-2 border-t border-line/70 px-4 py-3 text-[11px] text-mut sm:px-6">
          <span>
            Path: USER → AI AGENT → PROVIDER → PAYMENT → SOURCE CHAIN → ATTESTCOIN → CREDITCOIN → SETTLEMENT
          </span>
          <span className="font-mono">
            {orders.length === 0 ? 'no transactions yet' : `${settled}/${orders.length} settled`}
          </span>
        </div>
        <div className="px-4 pb-4 text-[11px] leading-relaxed text-mut sm:px-6">
          Drag a node to explore the graph; zoom with the wheel or pinch. Visualized state is the{' '}
          <span className="text-ink">real ledger state</span> behind each transaction — a pulse never moves past a
          stage the rail has not actually reached.{' '}
          {mode === 'production'
            ? 'In production mode, attestation stages reflect live Attestcoin proofs verified on Creditcoin CC3.'
            : 'Attestation stages are mirrored in the demo SettlementLedger; no live ASC submission is claimed.'}
        </div>
      </ReactFlowProvider>
    </div>
  );
}