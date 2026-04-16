import type { Template, TemplateHandle } from './registry';
import { resolveColor } from './palette';

/**
 * flow-diagram — a directed graph of labeled nodes and edges, rendered as
 * crisp SVG with HTML labels via foreignObject. Auto-fits its content to
 * the available frame via SVG viewBox (object-fit: contain semantics).
 *
 * Why SVG, not 3D? See docs/TEMPLATE-SPEC.md §9b. Short version: nodes
 * here are flat rectangles; the only thing that ever needed "3D" was
 * camera-dolly fit-to-frame, which viewBox does for free at any scale,
 * including the codesplain hero embed (which uses a CSS transform that
 * defeats canvas/WebGL backbuffer sizing).
 *
 * Slot schema (unchanged from the 3D version):
 *   nodes:     { id, label, icon?, group? }[]
 *   edges:     { from, to, label? }[]
 *   groups?:   { id, label, color }[]     (color can be "palette.primary")
 *   staggerMs: number
 *   layout:    "left-to-right" | "top-to-bottom" | "radial"
 *   orbit:     boolean — kept for API compatibility; ignored (was 3D camera).
 */

interface NodeSpec {
  id: string;
  label: string;
  icon?: string;
  group?: string;
}

interface EdgeSpec {
  from: string;
  to: string;
  label?: string;
}

interface GroupSpec {
  id: string;
  label: string;
  color: string;
}

interface FlowDiagramContent {
  nodes: NodeSpec[];
  edges?: EdgeSpec[];
  groups?: GroupSpec[];
  staggerMs?: number;
  layout?: 'left-to-right' | 'top-to-bottom' | 'radial';
  /** Was the 3D camera orbit toggle. Now a no-op; accepted for back-compat. */
  orbit?: boolean;
}

/* ── Layout constants (in viewBox units) ────────────────────────────── */

const NODE_W = 160;     // node card width
const NODE_H = 56;      // node card height
const NODE_RX = 12;     // corner radius
const FIT_PAD = 24;     // padding around the bounding box inside viewBox
const SVG_NS = 'http://www.w3.org/2000/svg';

export const flowDiagramTemplate: Template = {
  id: 'flow-diagram',
  description:
    'Directed graph of labeled nodes and edges, rendered as scalable SVG with staggered entrance. Good for architecture and data flow.',
  slots: {
    nodes: '{ id, label, icon?, group? }[] — nodes in the graph',
    edges: '{ from, to, label? }[] — directed edges',
    groups: '{ id, label, color }[] — optional node groups (color = CSS or palette.*)',
    staggerMs: 'number — delay between node entrances (default 250)',
    layout: '"left-to-right" | "top-to-bottom" | "radial"',
    orbit: 'boolean — accepted for back-compat; no-op in the SVG renderer',
  },
  demo: {
    label: 'Flow Diagram',
    content: {
      nodes: [
        { id: 'client', label: 'Browser', icon: '🖥', group: 'frontend' },
        { id: 'api', label: 'API Server', icon: '⚙', group: 'backend' },
        { id: 'auth', label: 'Auth Service', icon: '🛡', group: 'backend' },
        { id: 'db', label: 'PostgreSQL', icon: '💾', group: 'data' },
      ],
      edges: [
        { from: 'client', to: 'api', label: 'REST' },
        { from: 'api', to: 'auth', label: 'verify token' },
        { from: 'api', to: 'db', label: 'queries' },
      ],
      groups: [
        { id: 'frontend', label: 'Frontend', color: 'palette.primary' },
        { id: 'backend', label: 'Backend', color: 'palette.secondary' },
        { id: 'data', label: 'Data Layer', color: 'palette.accent' },
      ],
      staggerMs: 300,
      layout: 'left-to-right',
    },
    emphasizeAfter: { target: 'auth', delayMs: 3000 },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as FlowDiagramContent;
    const {
      nodes = [],
      edges = [],
      groups = [],
      staggerMs = 250,
      layout = 'left-to-right',
    } = content;

    // Map groups → colors (CSS strings).
    const groupColor = new Map<string, string>();
    for (const g of groups) groupColor.set(g.id, resolveColor(g.color));

    // Soft cap on graph complexity. Producer occasionally hands 20+ dense
    // nodes which become a ball of lines; keep the highest-degree ones.
    const { nodes: trimmedNodes, edges: trimmedEdges } = trimGraph(nodes, edges, 12);

    // Auto-flip orientation when the graph's natural shape fights the host
    // aspect. Read host clientWidth/Height — these ignore CSS transforms,
    // matching the design surface (see docs/TEMPLATE-SPEC.md §9b).
    const hostRect = presenter.domRoot.getBoundingClientRect();
    const viewW = hostRect.width || 1280;
    const viewH = hostRect.height || 720;
    const hostAspect = viewW / viewH;

    let effectiveLayout = layout;
    if (layout !== 'radial') {
      const ranks = computeRanks(trimmedNodes, trimmedEdges);
      const rankCount = Math.max(0, ...ranks) + 1;
      const widest = maxBucketSize(ranks);
      const graphRatio = rankCount / Math.max(1, widest);
      if (hostAspect >= 1.2 && graphRatio > 1.1) effectiveLayout = 'left-to-right';
      else if (hostAspect < 0.9 && graphRatio > 1.1) effectiveLayout = 'top-to-bottom';
    }

    // Compute centre positions for each node in viewBox-unit space.
    const positions = computeLayout(trimmedNodes, trimmedEdges, effectiveLayout);

    // Bounding box of the laid-out graph (incl. node footprint).
    const bounds = computeBounds(positions);

    // viewBox sized to the bounding box + padding. The SVG element itself
    // fills the host with preserveAspectRatio="xMidYMid meet" — that's
    // literally object-fit: contain, scaled at the GPU.
    const vbX = bounds.minX - FIT_PAD;
    const vbY = bounds.minY - FIT_PAD;
    const vbW = bounds.maxX - bounds.minX + FIT_PAD * 2;
    const vbH = bounds.maxY - bounds.minY + FIT_PAD * 2;

    /* ── Build the DOM container + SVG ─────────────────────────────── */

    const wrapper = document.createElement('div');
    wrapper.className = 'sb-flow-wrapper';
    wrapper.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sb-flow-svg');
    svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'display:block;overflow:visible;';

    // Arrowhead marker definition.
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <marker id="sb-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="#94a3b8"/>
      </marker>
    `;
    svg.appendChild(defs);

    /* ── Render edges first (so nodes paint over endpoints) ────────── */

    const edgeGroups: SVGGElement[] = [];
    trimmedEdges.forEach((e) => {
      const fromIdx = trimmedNodes.findIndex((n) => n.id === e.from);
      const toIdx = trimmedNodes.findIndex((n) => n.id === e.to);
      if (fromIdx < 0 || toIdx < 0) {
        edgeGroups.push(document.createElementNS(SVG_NS, 'g')); // placeholder
        return;
      }
      const a = positions[fromIdx];
      const b = positions[toIdx];
      const g = buildEdge(a, b, e.label);
      g.style.opacity = '0';
      g.style.transition = 'opacity 400ms ease';
      svg.appendChild(g);
      edgeGroups.push(g);
    });

    /* ── Render nodes ──────────────────────────────────────────────── */

    const nodeGroups = new Map<string, SVGGElement>();
    trimmedNodes.forEach((n, i) => {
      const pos = positions[i];
      const color = (n.group && groupColor.get(n.group)) || '#334155';
      const g = buildNode(pos.x, pos.y, n.label, color, n.icon);
      // Start invisible/small for stagger entrance.
      g.style.opacity = '0';
      g.style.transformOrigin = `${pos.x}px ${pos.y}px`;
      g.style.transform = 'scale(0.6)';
      g.style.transition = 'opacity 420ms ease, transform 420ms cubic-bezier(.2,.8,.3,1.2)';
      svg.appendChild(g);
      nodeGroups.set(n.id, g);
    });

    wrapper.appendChild(svg);
    presenter.domRoot.appendChild(wrapper);

    /* ── Stagger entrance ──────────────────────────────────────────── */

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    trimmedNodes.forEach((n, i) => {
      const tid = setTimeout(() => {
        const g = nodeGroups.get(n.id);
        if (!g) return;
        g.style.opacity = '1';
        g.style.transform = 'scale(1)';
      }, 80 + i * staggerMs);
      timeouts.push(tid);
    });

    trimmedEdges.forEach((e, i) => {
      const fromIdx = trimmedNodes.findIndex((n) => n.id === e.from);
      const toIdx = trimmedNodes.findIndex((n) => n.id === e.to);
      const later = Math.max(fromIdx, toIdx);
      const tid = setTimeout(() => {
        const g = edgeGroups[i];
        if (g) g.style.opacity = '1';
      }, 80 + later * staggerMs + 320);
      timeouts.push(tid);
    });

    /* ── Handle ────────────────────────────────────────────────────── */

    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize: (target) => {
        const g = nodeGroups.get(target);
        if (!g) return;
        const rect = g.querySelector<SVGRectElement>('.sb-flow-node-bg');
        if (!rect) return;
        const orig = rect.getAttribute('stroke') ?? '#ffffff';
        rect.setAttribute('stroke', '#ffeb3b');
        rect.setAttribute('stroke-width', '3');
        const tid = setTimeout(() => {
          rect.setAttribute('stroke', orig);
          rect.setAttribute('stroke-width', '1.5');
        }, 1400);
        timeouts.push(tid);
      },
    };
    return handle;
  },
};

/* ── Builders ─────────────────────────────────────────────────────── */

/**
 * Build a node group: rounded rect background + foreignObject with HTML
 * label so emoji/text render through the DOM rasterizer (crisp at any
 * scale). Centred on (cx, cy) in viewBox units.
 */
function buildNode(
  cx: number,
  cy: number,
  label: string,
  color: string,
  icon?: string
): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'sb-flow-node');

  const x = cx - NODE_W / 2;
  const y = cy - NODE_H / 2;

  // Background card with the group color as a left accent stripe.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('class', 'sb-flow-node-bg');
  bg.setAttribute('x', String(x));
  bg.setAttribute('y', String(y));
  bg.setAttribute('width', String(NODE_W));
  bg.setAttribute('height', String(NODE_H));
  bg.setAttribute('rx', String(NODE_RX));
  bg.setAttribute('ry', String(NODE_RX));
  bg.setAttribute('fill', '#1e293b');
  bg.setAttribute('stroke', '#ffffff');
  bg.setAttribute('stroke-opacity', '0.18');
  bg.setAttribute('stroke-width', '1.5');
  g.appendChild(bg);

  // Left accent stripe in the group color.
  const stripe = document.createElementNS(SVG_NS, 'rect');
  stripe.setAttribute('x', String(x));
  stripe.setAttribute('y', String(y));
  stripe.setAttribute('width', '6');
  stripe.setAttribute('height', String(NODE_H));
  stripe.setAttribute('rx', '3');
  stripe.setAttribute('ry', '3');
  stripe.setAttribute('fill', color);
  g.appendChild(stripe);

  // Label via foreignObject — gives us native text rendering, emoji,
  // ellipsis, font fallback. Inset from the stripe.
  const fo = document.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('x', String(x + 12));
  fo.setAttribute('y', String(y));
  fo.setAttribute('width', String(NODE_W - 16));
  fo.setAttribute('height', String(NODE_H));

  const labelDiv = document.createElement('div');
  labelDiv.className = 'sb-flow-node-label';
  labelDiv.style.cssText =
    'width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
    "font-family:system-ui,-apple-system,sans-serif;font-size:18px;font-weight:600;" +
    'color:#ffffff;text-shadow:0 1px 3px rgba(0,0,0,.6);' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em;';
  labelDiv.textContent = icon ? `${icon}  ${label}` : label;
  fo.appendChild(labelDiv);
  g.appendChild(fo);

  return g;
}

/**
 * Build an edge: a quadratic bezier path (slight bow so overlapping edges
 * stay distinguishable) with an arrowhead and an optional midpoint label.
 * The path stops at the edge of the target node, not its centre, so the
 * arrowhead lands on the box edge.
 */
function buildEdge(
  from: { x: number; y: number },
  to: { x: number; y: number },
  label?: string
): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'sb-flow-edge');

  // Trim endpoints to node rectangle borders so the line doesn't disappear
  // under the node and the arrowhead lands cleanly on the edge.
  const start = clipToRect(from, to);
  const end = clipToRect(to, from);

  // Slight perpendicular bow for visual separation.
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(28, len * 0.12);
  const mx = (start.x + end.x) / 2 + (-dy / len) * bow;
  const my = (start.y + end.y) / 2 + (dx / len) * bow;

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#94a3b8');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('marker-end', 'url(#sb-flow-arrow)');
  g.appendChild(path);

  if (label) {
    // Pill background + text at the midpoint so the label is readable
    // even when it crosses other edges.
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(mx));
    text.setAttribute('y', String(my + 4));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('font-size', '13');
    text.setAttribute('font-weight', '500');
    text.setAttribute('fill', '#cbd5e1');
    text.textContent = label;

    // Background pill — sized after measuring would be ideal, but
    // estimating from text length keeps this allocation-free.
    const padX = 6;
    const w = label.length * 7 + padX * 2;
    const h = 18;
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(mx - w / 2));
    bg.setAttribute('y', String(my - h / 2));
    bg.setAttribute('width', String(w));
    bg.setAttribute('height', String(h));
    bg.setAttribute('rx', '4');
    bg.setAttribute('ry', '4');
    bg.setAttribute('fill', '#0f172a');
    bg.setAttribute('fill-opacity', '0.8');
    g.appendChild(bg);
    g.appendChild(text);
  }

  return g;
}

/**
 * Clip the line from `from` toward `target` to the rectangle around `from`
 * (NODE_W × NODE_H centred on `from`). Returns the intersection point on
 * the rectangle boundary — that's where the visible line starts/ends.
 */
function clipToRect(
  from: { x: number; y: number },
  toward: { x: number; y: number }
): { x: number; y: number } {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return { ...from };
  const halfW = NODE_W / 2;
  const halfH = NODE_H / 2;
  // Parametric: from + t*(dx,dy) hits the rectangle boundary at the
  // smaller of the two axis-clip distances.
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/* ── Layout ───────────────────────────────────────────────────────── */

function computeLayout(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  layout: 'left-to-right' | 'top-to-bottom' | 'radial'
): Array<{ x: number; y: number }> {
  const n = nodes.length;
  if (n === 0) return [];

  if (layout === 'radial') {
    // Radius scales with node count so cards don't overlap.
    const r = Math.max(NODE_W * 1.2, n * NODE_W * 0.35);
    return nodes.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    });
  }

  const rank = computeRanks(nodes, edges);
  const maxRank = Math.max(0, ...rank);
  const buckets: NodeSpec[][] = Array.from({ length: maxRank + 1 }, () => []);
  nodes.forEach((node, i) => buckets[rank[i]].push(node));

  const horizontal = layout === 'left-to-right';
  // Spacing in viewBox units. Primary = along flow; cross = perpendicular.
  // Generous gaps so edges have room to bow without crossing labels.
  const primarySpacing = horizontal ? NODE_W * 1.6 : NODE_H * 2.4;
  const crossSpacing = horizontal ? NODE_H * 1.8 : NODE_W * 1.3;

  const positions: Record<string, { x: number; y: number }> = {};
  buckets.forEach((bucket, r) => {
    const count = bucket.length;
    bucket.forEach((node, k) => {
      const primary = (r - maxRank / 2) * primarySpacing;
      const cross = (k - (count - 1) / 2) * crossSpacing;
      positions[node.id] = horizontal
        ? { x: primary, y: cross }
        : { x: cross, y: primary };
    });
  });

  return nodes.map((nd) => positions[nd.id] ?? { x: 0, y: 0 });
}

function computeRanks(nodes: NodeSpec[], edges: EdgeSpec[]): number[] {
  const index = new Map<string, number>();
  nodes.forEach((n, i) => index.set(n.id, i));
  const rank = new Array(nodes.length).fill(0);
  const incoming: number[][] = Array.from({ length: nodes.length }, () => []);
  for (const e of edges) {
    const fi = index.get(e.from);
    const ti = index.get(e.to);
    if (fi != null && ti != null) incoming[ti].push(fi);
  }
  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false;
    for (let i = 0; i < nodes.length; i++) {
      for (const src of incoming[i]) {
        if (rank[src] + 1 > rank[i]) {
          rank[i] = rank[src] + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return rank;
}

function trimGraph(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  maxNodes: number
): { nodes: NodeSpec[]; edges: EdgeSpec[] } {
  if (nodes.length <= maxNodes) return { nodes, edges };
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const kept = new Set(
    [...nodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, maxNodes)
      .map((n) => n.id)
  );
  return {
    nodes: nodes.filter((n) => kept.has(n.id)),
    edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
  };
}

function maxBucketSize(ranks: number[]): number {
  const counts: Record<number, number> = {};
  for (const r of ranks) counts[r] = (counts[r] ?? 0) + 1;
  return Math.max(1, ...Object.values(counts));
}

function computeBounds(positions: Array<{ x: number; y: number }>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (positions.length === 0) {
    return { minX: -NODE_W / 2, minY: -NODE_H / 2, maxX: NODE_W / 2, maxY: NODE_H / 2 };
  }
  const halfW = NODE_W / 2;
  const halfH = NODE_H / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x - halfW);
    minY = Math.min(minY, p.y - halfH);
    maxX = Math.max(maxX, p.x + halfW);
    maxY = Math.max(maxY, p.y + halfH);
  }
  return { minX, minY, maxX, maxY };
}

