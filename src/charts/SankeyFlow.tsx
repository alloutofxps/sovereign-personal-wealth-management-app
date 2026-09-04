/* ===========================================================================
 * THE CASH-FLOW CANVAS
 * ---------------------------------------------------------------------------
 * Three columns of nodes and the ribbons between them. Bespoke SVG over
 * geometry we own — a Sankey library would bring its own colour opinions, its
 * own layout, and about forty kilobytes for a shape that is ultimately six
 * cubic Béziers.
 *
 * The layout runs once per graph and produces plain numbers. Every coordinate
 * is checked for finiteness before it reaches the DOM: an SVG path containing
 * NaN does not throw, it silently renders nothing, and a blank chart looks
 * exactly like "you have no data" to the person holding the phone.
 * ======================================================================== */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Minor } from '@/core/money';
import type { FlowLink, FlowNode, SankeyGraph } from '@/core/analytics';

export interface SankeyFlowProps {
  graph: SankeyGraph;
  /** Formats an amount for the readout. */
  format: (amount: Minor) => string;
  height?: number;
  /** Tapping the aggregate node opens its itemised list. */
  onSelectNode?: (node: FlowNode) => void;
}

interface PlacedNode extends FlowNode {
  x: number;
  y: number;
  width: number;
  nodeHeight: number;
}

interface PlacedLink extends FlowLink {
  path: string;
  thickness: number;
}

const NODE_WIDTH = 10;
const NODE_GAP = 10;
const PADDING = { top: 8, bottom: 8 };

const RIBBON_TONE: Record<FlowLink['tone'], string> = {
  income: 'var(--color-liquid)',
  fixed: 'var(--color-ink-3)',
  discretionary: 'var(--color-line-strong)',
  saving: 'var(--color-caution)',
  deficit: 'var(--color-deficit)',
};

const NODE_TONE: Record<FlowNode['kind'], string> = {
  income: 'var(--color-liquid)',
  reserves: 'var(--color-deficit)',
  stage: 'var(--color-ink-3)',
  category: 'var(--color-line-strong)',
  pot: 'var(--color-caution)',
  retained: 'var(--color-liquid-dim)',
  other: 'var(--color-line-strong)',
};

/**
 * Place every node and route every ribbon.
 *
 * Columns are laid out independently, each scaled so its own total fills the
 * available height. Ribbons leave a source stacked in link order and arrive at
 * a target the same way, which is what stops them crossing over themselves
 * inside a single node.
 */
function layout(graph: SankeyGraph, width: number, height: number) {
  const columns = [0, 1, 2].map((index) => graph.nodes.filter((n) => n.column === index));
  const usable = height - PADDING.top - PADDING.bottom;

  const placed = new Map<string, PlacedNode>();

  columns.forEach((column, columnIndex) => {
    if (column.length === 0) return;

    const total = column.reduce((sum, node) => sum + node.value, 0);
    const gaps = NODE_GAP * Math.max(0, column.length - 1);
    const drawable = Math.max(1, usable - gaps);

    const x =
      columnIndex === 0
        ? 0
        : columnIndex === 1
          ? (width - NODE_WIDTH) / 2
          : width - NODE_WIDTH;

    let y = PADDING.top;
    for (const node of column) {
      // A node worth nothing still needs a positive height, or its ribbons
      // collapse to a line and become untappable.
      const nodeHeight = total > 0 ? Math.max(2, (node.value / total) * drawable) : 2;
      placed.set(node.id, { ...node, x, y, width: NODE_WIDTH, nodeHeight });
      y += nodeHeight + NODE_GAP;
    }
  });

  // Where the next ribbon should attach on each side of each node.
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();

  const links: PlacedLink[] = [];

  for (const link of graph.links) {
    const source = placed.get(link.source);
    const target = placed.get(link.target);
    if (!source || !target) continue;

    const sourceTotal = source.value || 1;
    const targetTotal = target.value || 1;

    const thickness = Math.max(
      1,
      (link.value / sourceTotal) * source.nodeHeight,
    );
    const targetThickness = Math.max(1, (link.value / targetTotal) * target.nodeHeight);

    const sy = source.y + (outCursor.get(source.id) ?? 0) + thickness / 2;
    const ty = target.y + (inCursor.get(target.id) ?? 0) + targetThickness / 2;

    outCursor.set(source.id, (outCursor.get(source.id) ?? 0) + thickness);
    inCursor.set(target.id, (inCursor.get(target.id) ?? 0) + targetThickness);

    const x0 = source.x + source.width;
    const x1 = target.x;
    const curve = (x1 - x0) / 2;

    const path = `M ${x0},${sy} C ${x0 + curve},${sy} ${x1 - curve},${ty} ${x1},${ty}`;

    // A NaN anywhere in a path makes the whole ribbon vanish without an error.
    if (![x0, sy, x1, ty, curve, thickness].every(Number.isFinite)) continue;

    links.push({ ...link, path, thickness: Math.max(thickness, targetThickness) });
  }

  return { nodes: [...placed.values()], links };
}

export function SankeyFlow({ graph, format, height = 320, onSelectNode }: SankeyFlowProps) {
  const width = 320; // viewBox units; the SVG scales to its container
  const [active, setActive] = useState<string | null>(null);

  const { nodes, links } = useMemo(
    () => layout(graph, width, height),
    [graph, height],
  );

  if (graph.empty || nodes.length === 0) return null;

  /** Which node and ribbon ids are lit while something is being inspected. */
  const lit = (() => {
    if (!active) return null;
    const relatedNodes = new Set<string>([active]);
    const relatedLinks = new Set<string>();
    links.forEach((link, index) => {
      if (link.source === active || link.target === active) {
        relatedLinks.add(String(index));
        relatedNodes.add(link.source);
        relatedNodes.add(link.target);
      }
    });
    return { relatedNodes, relatedLinks };
  })();

  const activeNode = active ? nodes.find((n) => n.id === active) : null;

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Where your money went this period"
        onPointerLeave={() => setActive(null)}
      >
        <g>
          {links.map((link, index) => {
            const dimmed = lit !== null && !lit.relatedLinks.has(String(index));
            return (
              <path
                key={`${link.source}-${link.target}-${index}`}
                d={link.path}
                fill="none"
                stroke={RIBBON_TONE[link.tone]}
                strokeWidth={link.thickness}
                strokeOpacity={dimmed ? 0.07 : 0.34}
                className="transition-[stroke-opacity] duration-150"
              />
            );
          })}
        </g>

        <g>
          {nodes.map((node) => {
            const dimmed = lit !== null && !lit.relatedNodes.has(node.id);
            return (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.nodeHeight}
                rx={2}
                fill={NODE_TONE[node.kind]}
                opacity={dimmed ? 0.2 : 0.95}
                className="cursor-pointer transition-opacity duration-150"
                onPointerEnter={() => setActive(node.id)}
                onClick={() => {
                  setActive(node.id);
                  onSelectNode?.(node);
                }}
              />
            );
          })}
        </g>
      </svg>

      {/* The readout sits below rather than floating over the ribbons: a
          tooltip under a thumb on a phone covers the thing being pointed at. */}
      <div className="min-h-[2.5rem] rounded-md border border-line bg-raised px-3 py-2">
        {activeNode ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-caption text-ink">{activeNode.name}</span>
            <span className="shrink-0 text-caption text-ink-2 tnum">
              {format(activeNode.value)}
              {graph.totalIn > 0 && (
                <span className="pl-2 text-ink-3">
                  {Math.round((activeNode.value / graph.totalIn) * 100)}%
                </span>
              )}
            </span>
          </div>
        ) : (
          <p className="text-caption text-ink-3">
            Tap any band to see what it is and what it came to.
          </p>
        )}
      </div>
    </div>
  );
}

/** A key, so the colours mean something without being tapped. */
export function SankeyLegend({ graph }: { graph: SankeyGraph }) {
  const entries: { tone: FlowLink['tone']; label: string; show: boolean }[] = [
    { tone: 'income', label: 'Money in', show: true },
    { tone: 'fixed', label: 'Bills', show: graph.links.some((l) => l.tone === 'fixed') },
    {
      tone: 'discretionary',
      label: 'Day to day',
      show: graph.links.some((l) => l.tone === 'discretionary'),
    },
    { tone: 'saving', label: 'Put by', show: graph.links.some((l) => l.tone === 'saving') },
    { tone: 'deficit', label: 'From savings', show: graph.drewOnReserves },
  ];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {entries
        .filter((entry) => entry.show)
        .map((entry) => (
          <span key={entry.tone} className="flex items-center gap-1.5 text-caption text-ink-3">
            <span
              className={clsx('size-2 rounded-full')}
              style={{ backgroundColor: RIBBON_TONE[entry.tone] }}
              aria-hidden="true"
            />
            {entry.label}
          </span>
        ))}
    </div>
  );
}
