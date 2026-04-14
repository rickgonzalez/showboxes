import type { Template, TemplateHandle } from './registry';

/**
 * code-cloud — a weighted word cloud of code concepts. DOM-based so text stays
 * crisp at any size. Weight drives font size (0.0 → smallest, 1.0 → largest).
 * Categories drive color. Items enter with a configurable style and then
 * float gently in place.
 *
 * Slot schema:
 *   items:          { text, weight, category }[]
 *   categoryColors: Record<string, string>  (CSS color or "palette.primary")
 *   entranceStyle:  "scatter" | "spiral" | "typewriter"
 */

interface CloudItem {
  text: string;
  weight: number;
  category: string;
}

interface CodeCloudContent {
  items: CloudItem[];
  categoryColors?: Record<string, string>;
  entranceStyle?: 'scatter' | 'spiral' | 'typewriter';
}

const PALETTE_DEFAULTS: Record<string, string> = {
  'palette.primary': '#60a5fa',
  'palette.secondary': '#a78bfa',
  'palette.accent': '#34d399',
};

export const codeCloudTemplate: Template = {
  id: 'code-cloud',
  description:
    'Weighted DOM word cloud for code concepts. Scatter / spiral / typewriter entrance; gentle float after placement.',
  slots: {
    items: '{ text: string, weight: number, category: string }[] — cloud items',
    categoryColors: 'Record<string, string> — category → color (CSS or palette.* alias)',
    entranceStyle: '"scatter" | "spiral" | "typewriter" — how items appear',
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as CodeCloudContent;
    const {
      items = [],
      categoryColors = {},
      entranceStyle = 'spiral',
    } = content;

    const container = document.createElement('div');
    container.className = 'sb-cloud';

    // Sort by weight desc so big items claim space first.
    const sorted = [...items].sort((a, b) => b.weight - a.weight);

    // Size range in px — tuned so max reads as headline, min reads as hint.
    const MIN_SIZE = 16;
    const MAX_SIZE = 72;

    // Precompute per-item pixel sizes so the layout can avoid overlap.
    const sizes = sorted.map((item) => MIN_SIZE + (MAX_SIZE - MIN_SIZE) * clamp01(item.weight));

    // Reference stage dims for converting pixel sizes → percent.
    // Falls back to a sensible 16:9 if the presenter stage isn't measured yet.
    const stageRect = presenter.domRoot.getBoundingClientRect();
    const stageW = stageRect.width || 1280;
    const stageH = stageRect.height || 720;

    // Estimate item footprint in percent (rough — .6 avg glyph width, 1.2 line height).
    const footprints = sorted.map((item, i) => ({
      w: ((item.text.length * sizes[i] * 0.6) / stageW) * 100,
      h: ((sizes[i] * 1.2) / stageH) * 100,
    }));

    // Precompute positions based on entrance style and item footprints so
    // items start with breathing room instead of piling up.
    const positions = computePositions(sorted, entranceStyle, footprints);

    const itemEls: HTMLSpanElement[] = [];
    sorted.forEach((item, i) => {
      const el = document.createElement('span');
      el.className = 'sb-cloud-item';
      el.textContent = item.text;

      const size = sizes[i];
      el.style.fontSize = `${size.toFixed(1)}px`;
      el.style.fontWeight = item.weight > 0.7 ? '800' : item.weight > 0.4 ? '600' : '500';
      el.style.color = resolveColor(categoryColors[item.category]);

      const { x, y } = positions[i];
      el.style.left = `${x.toFixed(2)}%`;
      el.style.top = `${y.toFixed(2)}%`;

      // Per-item gentle float — random phase so items don't all move together.
      const floatDur = 4000 + Math.random() * 3000;
      const floatDelay = Math.random() * 2000;
      el.style.setProperty('--sb-cloud-float-dur', `${floatDur}ms`);
      el.style.setProperty('--sb-cloud-float-delay', `${floatDelay}ms`);

      container.appendChild(el);
      itemEls.push(el);
    });

    presenter.domRoot.appendChild(container);

    // Entrance animation — depends on style.
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const reveal = (el: HTMLSpanElement, delay: number) => {
      const tid = setTimeout(() => el.classList.add('sb-visible'), delay);
      timeouts.push(tid);
    };

    if (entranceStyle === 'typewriter') {
      // One at a time, left to right (in weight order).
      itemEls.forEach((el, i) => reveal(el, 100 + i * 140));
    } else if (entranceStyle === 'scatter') {
      // Random-ish stagger for a scattered feel.
      itemEls.forEach((el, i) => reveal(el, 80 + i * 60 + Math.random() * 200));
    } else {
      // Spiral — big items first, smaller ones outward.
      itemEls.forEach((el, i) => reveal(el, 150 + i * 90));
    }

    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        container.remove();
      },
      emphasize: (target) => {
        const match = itemEls.find(
          (el) => el.textContent?.toLowerCase() === target.toLowerCase()
        );
        if (match) {
          match.classList.add('sb-cloud-emphasize');
          setTimeout(() => match.classList.remove('sb-cloud-emphasize'), 1600);
        }
      },
    };
    return handle;
  },
};

/**
 * Compute positions (in percent of container) for each item based on its
 * index, the chosen entrance style, and each item's footprint. Uses a simple
 * collision-aware placement: each item starts at a style-driven anchor, then
 * nudges outward along the spiral direction until it doesn't overlap any
 * already-placed item (with a small gap for breathing room).
 */
function computePositions(
  items: CloudItem[],
  style: 'scatter' | 'spiral' | 'typewriter',
  footprints: Array<{ w: number; h: number }>
): Array<{ x: number; y: number }> {
  const GAP = 1.2; // extra percent of breathing room between items
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

  const overlaps = (x: number, y: number, w: number, h: number) =>
    placed.some(
      (p) =>
        Math.abs(p.x - x) < (p.w + w) / 2 + GAP &&
        Math.abs(p.y - y) < (p.h + h) / 2 + GAP
    );

  const place = (x: number, y: number, i: number) => {
    const { w, h } = footprints[i];
    placed.push({ x, y, w, h });
    return { x, y };
  };

  if (style === 'typewriter') {
    // Flow in rows, centered — pack row-by-row using actual item widths.
    const positions: Array<{ x: number; y: number }> = [];
    const leftPad = 8;
    const rightEdge = 92;
    const rowGap = 2;
    let cursorX = leftPad;
    let rowY = 20;
    let rowH = 0;
    items.forEach((_, i) => {
      const { w, h } = footprints[i];
      if (cursorX + w > rightEdge && cursorX > leftPad) {
        rowY += rowH + rowGap;
        cursorX = leftPad;
        rowH = 0;
      }
      const cx = cursorX + w / 2;
      const cy = rowY + h / 2;
      positions.push(place(cx, cy, i));
      cursorX += w + GAP;
      rowH = Math.max(rowH, h);
    });
    // Center vertically by shifting all positions so the block sits ~centered.
    const totalH = rowY + rowH - 20;
    const shift = Math.max(0, (100 - totalH) / 2 - 20);
    return positions.map((p) => ({ x: p.x, y: p.y + shift }));
  }

  // Both spiral and scatter use an anchor + outward-spiral collision resolve.
  // Scatter seeds the anchor pseudo-randomly; spiral seeds it on the curve.
  return items.map((_, i) => {
    const { w, h } = footprints[i];
    let ax: number;
    let ay: number;
    if (style === 'scatter') {
      const a = seededRand(i * 9301 + 49297);
      const b = seededRand(i * 7919 + 104729);
      ax = 15 + a * 70;
      ay = 20 + b * 60;
    } else {
      // Spiral — classic Archimedean, heavier items near center.
      const angle = i * 0.7;
      const radius = 2 + i * 2.6;
      ax = 50 + Math.cos(angle) * radius;
      ay = 50 + Math.sin(angle) * radius * 0.75;
    }

    // If the anchor collides, walk outward along an Archimedean spiral
    // relative to the stage center until we find a free spot.
    let x = ax;
    let y = ay;
    if (overlaps(x, y, w, h)) {
      const startAngle = Math.atan2(ay - 50, ax - 50 || 0.0001);
      const startR = Math.hypot(ax - 50, ay - 50);
      for (let step = 1; step <= 240; step++) {
        const t = step * 0.35;
        const r = startR + t * 1.1;
        const ang = startAngle + t * 0.6;
        x = 50 + Math.cos(ang) * r;
        y = 50 + Math.sin(ang) * r * 0.75;
        if (x < 6 || x > 94 || y < 6 || y > 94) continue;
        if (!overlaps(x, y, w, h)) break;
      }
    }
    return place(x, y, i);
  });
}

function resolveColor(input?: string): string {
  if (!input) return '#e6e8ee';
  if (input.startsWith('palette.')) return PALETTE_DEFAULTS[input] ?? '#e6e8ee';
  return input;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function seededRand(seed: number): number {
  // Tiny deterministic [0,1) hash — good enough for scatter placement.
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
