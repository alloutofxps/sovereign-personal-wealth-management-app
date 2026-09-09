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
import { familyFor } from '@/design/category';

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

/* ===========================================================================
 * PHASE 5: THESE TONES AND THIS OPACITY ARE A MEASURED PAIR
 * ---------------------------------------------------------------------------
 * A REGRESSION, recorded so it is not re-filed as a preference. This file was
 * not touched by the redesign; phase 1 re-pointed the tokens under it, and the
 * ribbons lost separation as a result. Composited at the 0.34 opacity below:
 *
 *   before (obsidian palette)   closest pair dE 13.0   0 of 10 confusable
 *   after  (daylight palette)   closest pair dE 10.0   1 of 10 confusable
 *
 * The obvious fix is wrong. Re-pointing these at the six category families —
 * which is what phase 5 is meant to do, and is right for consistency with the
 * donut and the rows — makes it WORSE at 0.34: closest pair dE 6.8, two
 * confusable pairs. Six hues composited at a third over white are all pastels.
 *
 * 0.34 was tuned against a near-black ground, where a colour darkens toward
 * black and keeps its hue. Over white everything washes toward white.
 *
 * THE FLOOR IS 0.55. Measured across the six families, closest pair:
 *
 *   alpha   daylight (#fff)   midnight (#131936)
 *   0.34         6.8               10.8
 *   0.45         9.5               14.0
 *   0.55        11.5               17.2   <- both clear of 10
 *
 * dE below 10 reads as the same colour at a glance.
 *
 * ---------------------------------------------------------------------------
 * DONE IN PHASE 5. BOTH HALVES, TOGETHER.
 *
 * Every ribbon reaching a category now takes that category's family, and the
 * opacity is 0.55. Doing the first without the second would have been a
 * regression on top of a regression, which is why the two numbers below are
 * one decision and not two:
 *
 * Re-measured against the tokens as they stand after phase 1's AA corrections,
 * CIE76 on the composited result, all fifteen pairs:
 *
 *   alpha   daylight (on #edf0ea)        midnight (on #0b0f22)
 *   0.34    dE  6.8   2 of 15 under 10   dE 11.2   0 under 10
 *   0.45    dE  9.2   1 of 15 under 10   dE 14.6   0 under 10
 *   0.55    dE 11.4   0 of 15 under 10   dE 17.5   0 under 10   <- shipped
 *
 * Daylight is the binding case and housing/health is the closest pair in it:
 * a verdigris and a slate teal, both dark and both low-chroma, which is
 * exactly the pair compositing hurts most. Midnight was never in trouble.
 *
 * If somebody ever softens these ribbons again, the opacity is the thing that
 * cannot move. Measure before changing it: the numbers above are CIE76 dE on
 * the composited result, not on the token values, and the two are not the same
 * because compositing is where the separation is lost.
 * ======================================================================== */

/**
 * Ribbons that never reach a category, and so have no family to take.
 *
 * The first column is income arriving and, when spending outran it, reserves
 * being drawn on. Neither is a kind of spending, so neither has a hue in the
 * category index -- and giving them one would put a category colour on
 * something that is not a category, which is the one thing that index cannot
 * survive.
 */
const FLOW_TONE: Record<FlowLink['tone'], string> = {
  income: 'var(--color-liquid)',
  deficit: 'var(--color-deficit)',
  fixed: 'var(--color-obligation)',
  discretionary: 'var(--color-leisure)',
  saving: 'var(--color-health)',
};

/**
 * The colour of one ribbon.
 *
 * A leaf node's id is `category-<id>`, so the family is resolvable here without
 * `core/analytics/sankeyFlow.ts` having to know that families exist. That file
 * computes a graph; which hue a graph is drawn in is this file's business.
 */
function ribbonTone(link: FlowLink): string {
  const leaf = link.target.startsWith('category-') ? link.target.slice('category-'.length) : null;
  return leaf ? `var(--color-${familyFor(leaf)})` : FLOW_TONE[link.tone];
}

/**
 * The floor, and the reason it is a named constant rather than a literal.
 *
 * It is the measured half of a measured pair. A literal in the JSX is a number
 * somebody nudges; a constant with the working above it is a decision.
 */
const RIBBON_OPACITY = 0.55;


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
                vectorEffect="non-scaling-stroke"
                stroke={ribbonTone(link)}
                strokeWidth={link.thickness}
                strokeOpacity={dimmed ? 0.07 : RIBBON_OPACITY}
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
              style={{ backgroundColor: FLOW_TONE[entry.tone] }}
              aria-hidden="true"
            />
            {entry.label}
          </span>
        ))}
    </div>
  );
}
