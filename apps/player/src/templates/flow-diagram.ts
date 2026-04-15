import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Template, TemplateHandle } from './registry';
import type { Stage3DItem } from '../core/Stage3D';

/**
 * flow-diagram — a directed graph rendered in 3D. Labeled nodes, edges
 * between them, optional node grouping with color. Designed as an animated
 * whiteboard sketch, not a full diagramming tool. Nodes appear with stagger,
 * edges draw in after both endpoints are visible, and the camera can slowly
 * orbit.
 *
 * Slot schema (matches architecture spec):
 *   nodes:     { id, label, icon?, group? }[]
 *   edges:     { from, to, label? }[]
 *   groups?:   { id, label, color }[]     (color can be "palette.primary")
 *   staggerMs: number
 *   layout:    "left-to-right" | "top-to-bottom" | "radial"
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
  /** Whether the camera slowly orbits the scene (default true). */
  orbit?: boolean;
}

const PALETTE_DEFAULTS: Record<string, string> = {
  'palette.primary': '#60a5fa',
  'palette.secondary': '#a78bfa',
  'palette.accent': '#34d399',
};

export const flowDiagramTemplate: Template = {
  id: 'flow-diagram',
  description:
    'Directed graph of labeled nodes and edges, rendered in 3D with staggered entrance. Good for architecture and data flow.',
  slots: {
    nodes: '{ id, label, icon?, group? }[] — nodes in the graph',
    edges: '{ from, to, label? }[] — directed edges',
    groups: '{ id, label, color }[] — optional node groups (color = CSS or palette.*)',
    staggerMs: 'number — delay between node entrances (default 250)',
    layout: '"left-to-right" | "top-to-bottom" | "radial"',
    orbit: 'boolean — whether the camera slowly orbits (default true)',
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
      orbit: true,
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
      orbit = true,
    } = content;

    const stage = presenter.stage3d;
    if (!stage) {
      // Presenter was constructed without a 3D host — render a fallback notice.
      const note = document.createElement('div');
      note.className = 'sb-flow-fallback';
      note.textContent = 'flow-diagram requires a 3D layer (stage3dHost).';
      presenter.domRoot.appendChild(note);
      return {
        dismiss: () => note.remove(),
      };
    }

    // Map groups → colors.
    const groupColor = new Map<string, number>();
    for (const g of groups) {
      groupColor.set(g.id, parseColor(resolveColor(g.color)));
    }

    // Soft cap on graph complexity — the Producer sometimes hands us 20+ nodes
    // with dense edges, which becomes an unreadable ball of lines. Keep the
    // highest-degree nodes and drop the rest (with their edges).
    const { nodes: trimmedNodes, edges: trimmedEdges } = trimGraph(nodes, edges, 12);

    // Figure out the actual viewport aspect so we can (a) fit properly and
    // (b) flip orientation when the Producer picked one that fights the frame.
    // Stage3D may not have synced size yet on first tick — fall back to 16:9.
    const viewW = stage.width > 0 ? stage.width : 16;
    const viewH = stage.height > 0 ? stage.height : 9;
    const aspect = viewW / viewH;

    // Orientation auto-correction: for deep graphs (many ranks, narrow per
    // rank) in a wide viewport, vertical stacks clip top/bottom while wasting
    // horizontal room. Flip when the chosen axis clearly disagrees with the
    // frame. Radial stays as-is.
    let effectiveLayout = layout;
    if (layout !== 'radial') {
      const ranks = computeRanks(trimmedNodes, trimmedEdges);
      const rankCount = Math.max(0, ...ranks) + 1;
      const widest = maxBucketSize(ranks);
      // Ratio of "along-flow" to "cross-flow" that the graph wants.
      const graphRatio = rankCount / Math.max(1, widest);
      // If graph wants to be long-and-thin and the frame is wide, prefer LTR.
      // If graph wants to be tall-and-thin and the frame is tall, prefer TTB.
      if (aspect >= 1.2 && graphRatio > 1.1) effectiveLayout = 'left-to-right';
      else if (aspect < 0.9 && graphRatio > 1.1) effectiveLayout = 'top-to-bottom';
    }

    // Compute node positions based on (possibly overridden) layout.
    const positions = computeLayout(trimmedNodes, trimmedEdges, effectiveLayout);

    // Build nodes — rounded box meshes + CSS2D labels.
    const nodeObjs = new Map<string, THREE.Group>();
    const nodeItems: Stage3DItem[] = [];

    trimmedNodes.forEach((n, i) => {
      const color = n.group ? groupColor.get(n.group) ?? 0x334155 : 0x334155;
      const group = buildNode(n.label, color, n.icon);
      const pos = positions[i];
      group.position.set(pos.x, pos.y, 0);
      // Start invisible/small and animate in.
      group.scale.setScalar(0.01);
      (group.userData as { targetScale: number }).targetScale = 1;

      const item: Stage3DItem = {
        object: group,
        update: makeScaleIn(group, 1, 500),
      };
      // Don't add yet — stagger in via setTimeout.
      nodeObjs.set(n.id, group);
      nodeItems.push(item);
    });

    // Build edges — tube lines from source to target with optional label.
    const edgeItems: Stage3DItem[] = [];
    const edgeObjs: THREE.Object3D[] = [];
    trimmedEdges.forEach((e) => {
      const a = nodeObjs.get(e.from);
      const b = nodeObjs.get(e.to);
      if (!a || !b) return;
      const line = buildEdge(a.position, b.position, e.label);
      line.visible = false; // revealed after both endpoints are visible
      edgeObjs.push(line);
      edgeItems.push({ object: line });
    });

    // Fit-to-frame: the Producer's layouts often exceed the camera frustum
    // (20×11 world units at z=0). Compute the graph's bounding box from node
    // positions + node footprint, then apply a uniform world-scale offset so
    // the whole diagram stays on screen with some padding. We apply this by
    // scaling each node's position + shrinking node scale target, so edges
    // (which read positions at build time, already baked in) rescale too
    // when we rebuild their geometry here.
    const fit = computeFitScale(positions, aspect);
    if (fit < 1) {
      // Rescale node positions.
      trimmedNodes.forEach((_, i) => {
        positions[i].x *= fit;
        positions[i].y *= fit;
        const g = nodeItems[i].object as THREE.Group;
        g.position.set(positions[i].x, positions[i].y, 0);
        // Also shrink target scale so big nodes don't crowd tight layouts.
        (g.userData as { targetScale: number }).targetScale = fit;
        nodeItems[i].update = makeScaleIn(g, fit, 500);
      });
      // Rebuild edges against the rescaled endpoints.
      edgeObjs.forEach((_obj, i) => {
        const e = trimmedEdges[i];
        const fromIdx = trimmedNodes.findIndex((n) => n.id === e.from);
        const toIdx = trimmedNodes.findIndex((n) => n.id === e.to);
        if (fromIdx < 0 || toIdx < 0) return;
        const a = new THREE.Vector3(positions[fromIdx].x, positions[fromIdx].y, 0);
        const b = new THREE.Vector3(positions[toIdx].x, positions[toIdx].y, 0);
        const rebuilt = buildEdge(a, b, e.label);
        rebuilt.visible = false;
        // Swap the item's object so add/remove still works.
        edgeItems[i].object = rebuilt;
        edgeObjs[i] = rebuilt;
      });
    }

    // Stagger entrance.
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    nodeItems.forEach((item, i) => {
      const tid = setTimeout(() => {
        stage.add(item);
      }, i * staggerMs);
      timeouts.push(tid);
    });

    // Edges appear after their slower endpoint has had time to enter.
    trimmedEdges.forEach((e, i) => {
      const fromIdx = trimmedNodes.findIndex((n) => n.id === e.from);
      const toIdx = trimmedNodes.findIndex((n) => n.id === e.to);
      const later = Math.max(fromIdx, toIdx);
      const delay = later * staggerMs + 400;
      const tid = setTimeout(() => {
        const item = edgeItems[i];
        item.object.visible = true;
        stage.add(item);
      }, delay);
      timeouts.push(tid);
    });

    // Camera orbit — a very slow, small-angle rotation around the center.
    let orbitItem: Stage3DItem | null = null;
    if (orbit) {
      const camera = stage.camera;
      const baseZ = camera.position.z;
      orbitItem = {
        // Dummy object — we just need update() to run each frame.
        object: new THREE.Object3D(),
        update: (_dt, elapsed) => {
          const angle = Math.sin(elapsed * 0.15) * 0.25;
          camera.position.x = Math.sin(angle) * baseZ;
          camera.position.z = Math.cos(angle) * baseZ;
          camera.lookAt(0, 0, 0);
        },
      };
      stage.add(orbitItem);
    }

    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        nodeItems.forEach((it) => stage.remove(it));
        edgeItems.forEach((it) => stage.remove(it));
        if (orbitItem) stage.remove(orbitItem);
        // Reset camera for subsequent scenes.
        stage.camera.position.set(0, 0, 12);
        stage.camera.lookAt(0, 0, 0);
      },
      emphasize: (target) => {
        const group = nodeObjs.get(target);
        if (!group) return;
        // Pulse scale.
        const originalScale = group.scale.x;
        let t = 0;
        const pulseObj: Stage3DItem = {
          object: new THREE.Object3D(),
          update: (dt) => {
            t += dt;
            const s = originalScale + Math.sin(t * 8) * 0.15 * Math.exp(-t * 2);
            group.scale.setScalar(s);
            if (t > 1.5) {
              group.scale.setScalar(originalScale);
              stage.remove(pulseObj);
            }
          },
        };
        stage.add(pulseObj);
      },
    };
    return handle;
  },
};

/**
 * Build a node as a rounded-ish box mesh + a CSS2D text label. The icon
 * string is rendered in the label (emoji/glyph work fine).
 */
function buildNode(label: string, color: number, icon?: string): THREE.Group {
  const group = new THREE.Group();

  // Box — flat and wide, more "card" than "cube". Kept modest so dense
  // graphs (10+ nodes) don't push off-screen at the camera's default z=12.
  const geometry = new THREE.BoxGeometry(2.0, 0.85, 0.2);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  // Subtle outline edge to give it definition.
  const edges = new THREE.EdgesGeometry(geometry);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  const line = new THREE.LineSegments(edges, lineMat);
  group.add(line);

  // CSS2D label — crisp HTML text that always faces the camera.
  const el = document.createElement('div');
  el.className = 'sb-flow-node-label';
  el.textContent = icon ? `${icon}  ${label}` : label;
  // We avoid importing CSS2DObject directly here; Stage3D.makeLabel does it.
  // But we need to construct one, so re-import the class lazily.
  const labelObj = makeCSS2DLabel(el);
  labelObj.position.set(0, 0, 0.15); // slightly in front of the box face
  group.add(labelObj);

  return group;
}

/**
 * Build an edge between two positions as a thin curved tube with an optional
 * label at the midpoint. Straight-ish with a slight bow so overlapping edges
 * remain distinguishable.
 */
function buildEdge(
  from: THREE.Vector3,
  to: THREE.Vector3,
  label?: string
): THREE.Group {
  const group = new THREE.Group();

  // Slight curve: bow toward positive-Z so edges lift off the node plane.
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mid.z += 0.4;

  const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
  const geometry = new THREE.TubeGeometry(curve, 24, 0.035, 8, false);
  const material = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.7,
  });
  const tube = new THREE.Mesh(geometry, material);
  group.add(tube);

  // Arrowhead cone pointing along the curve's last segment.
  const tangent = curve.getTangent(1).normalize();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.3, 10),
    new THREE.MeshBasicMaterial({ color: 0x94a3b8 })
  );
  cone.position.copy(to);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  group.add(cone);

  // Optional label near the midpoint.
  if (label) {
    const el = document.createElement('div');
    el.className = 'sb-flow-edge-label';
    el.textContent = label;
    const labelObj = makeCSS2DLabel(el);
    labelObj.position.copy(mid);
    group.add(labelObj);
  }

  return group;
}

/**
 * Layout the nodes in a plane (z = 0) based on the chosen strategy.
 */
function computeLayout(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  layout: 'left-to-right' | 'top-to-bottom' | 'radial'
): Array<{ x: number; y: number }> {
  const n = nodes.length;
  if (n === 0) return [];

  if (layout === 'radial') {
    return nodes.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = Math.max(2.4, n * 0.55);
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    });
  }

  // For left-to-right / top-to-bottom, compute rank (longest path from roots)
  // so edges point forward where possible.
  const rank = computeRanks(nodes, edges);
  const maxRank = Math.max(0, ...rank);
  const buckets: NodeSpec[][] = Array.from({ length: maxRank + 1 }, () => []);
  nodes.forEach((node, i) => buckets[rank[i]].push(node));

  const positions: Record<string, { x: number; y: number }> = {};
  const horizontal = layout === 'left-to-right';
  // Node footprint is 2.0 × 0.85. "primary" is along the flow axis, "cross"
  // is perpendicular. Label text lives inside 2.0-wide boxes, so horizontal
  // neighbours need ≥ node-width + gap to stay readable. Previously primary
  // was 2.8 (only 0.8 gap between rank centres) — labels overlapped on wide
  // graphs. Scale cross-spacing by the box's short side too.
  const primarySpacing = horizontal ? 4.0 : 2.4; // along flow
  const crossSpacing = horizontal ? 1.8 : 3.2;   // perpendicular

  buckets.forEach((bucket, r) => {
    const count = bucket.length;
    bucket.forEach((node, k) => {
      const primary = (r - maxRank / 2) * primarySpacing;
      const cross = (k - (count - 1) / 2) * crossSpacing;
      positions[node.id] = horizontal
        ? { x: primary, y: -cross }
        : { x: cross, y: -primary };
    });
  });

  return nodes.map((n) => positions[n.id] ?? { x: 0, y: 0 });
}

/**
 * Compute a simple rank for each node = length of longest incoming path.
 * Falls back to 0 for roots. Cycle-safe (bounded by node count).
 */
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
  // Relax ranks up to n times.
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

/**
 * Drop low-degree nodes (and any edges touching them) when the graph is
 * larger than `maxNodes`. We rank nodes by edge degree so the hubs stay —
 * those are usually the ones worth showing. Pure nodes (no edges) are the
 * first to go.
 */
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

/**
 * Compute a uniform scale factor that fits the node positions + their
 * footprint into a safe portion of the camera frustum. Camera is at z=12 with
 * fov=50° → visible plane at z=0 is ~11.2 tall; we use 90% of that. Width is
 * derived from the runtime aspect ratio (assumed ~16:9 worst case). Returns
 * 1.0 when no scaling is needed.
 */
function computeFitScale(
  positions: Array<{ x: number; y: number }>,
  aspect: number
): number {
  if (positions.length === 0) return 1;
  // Include half a node footprint in the bounds so node edges don't clip.
  const halfW = 1.0 + 0.3; // node half-width + padding
  const halfH = 0.425 + 0.3;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x - halfW);
    maxX = Math.max(maxX, p.x + halfW);
    minY = Math.min(minY, p.y - halfH);
    maxY = Math.max(maxY, p.y + halfH);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  // Camera: fov 50° at z=12 → visible height at z=0 ≈ 11.19. Width derives
  // from the actual viewport aspect, not a hardcoded 16:9. 90% keeps edges
  // off the frame.
  const safeH = 11.19 * 0.9;
  const safeW = safeH * aspect;
  const scale = Math.min(safeW / spanX, safeH / spanY, 1);
  return scale;
}

/** Max bucket size when ranks are the keys. */
function maxBucketSize(ranks: number[]): number {
  const counts: Record<number, number> = {};
  for (const r of ranks) counts[r] = (counts[r] ?? 0) + 1;
  return Math.max(1, ...Object.values(counts));
}

/** Scale an object from its current scale to target over `durationMs`. */
function makeScaleIn(
  obj: THREE.Object3D,
  target: number,
  durationMs: number
): (dt: number) => void {
  let t = 0;
  const startScale = obj.scale.x;
  return (dt: number) => {
    if (t >= durationMs / 1000) return;
    t += dt;
    const p = Math.min(1, t / (durationMs / 1000));
    // Ease-out-cubic.
    const eased = 1 - Math.pow(1 - p, 3);
    const s = startScale + (target - startScale) * eased;
    obj.scale.setScalar(s);
  };
}

function resolveColor(input: string): string {
  return input.startsWith('palette.') ? PALETTE_DEFAULTS[input] ?? '#334155' : input;
}

function parseColor(css: string): number {
  // Handle #rrggbb; fall back to neutral slate if anything else.
  if (/^#[0-9a-fA-F]{6}$/.test(css)) return parseInt(css.slice(1), 16);
  return 0x334155;
}

/** Helper: create a CSS2D label that always faces the camera and stays crisp. */
function makeCSS2DLabel(el: HTMLElement): CSS2DObject {
  return new CSS2DObject(el);
}
