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

    // Precompute positions based on entrance style.
    // Positions are in percent (relative to the container) — responsive to
    // stage resize without recomputation.
    const positions = computePositions(sorted, entranceStyle);

    const itemEls: HTMLSpanElement[] = [];
    sorted.forEach((item, i) => {
      const el = document.createElement('span');
      el.className = 'sb-cloud-item';
      el.textContent = item.text;

      const size = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * clamp01(item.weight);
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
 * index and the chosen entrance style. Not a full force-directed layout —
 * simple deterministic placement that looks reasonable.
 */
function computePositions(
  items: CloudItem[],
  style: 'scatter' | 'spiral' | 'typewriter'
): Array<{ x: number; y: number }> {
  const count = items.length;
  if (style === 'typewriter') {
    // Flow in rows, centered.
    return items.map((_, i) => {
      const perRow = 5;
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const totalRows = Math.ceil(count / perRow);
      return {
        x: 15 + (col / Math.max(1, perRow - 1)) * 70,
        y: 30 + (row / Math.max(1, totalRows)) * 40,
      };
    });
  }

  if (style === 'scatter') {
    // Pseudo-random (deterministic per index) scatter within a bounded box.
    return items.map((_, i) => {
      const a = seededRand(i * 9301 + 49297);
      const b = seededRand(i * 7919 + 104729);
      return {
        x: 15 + a * 70,
        y: 20 + b * 60,
      };
    });
  }

  // Spiral — classic Archimedean, heavier items near the center.
  return items.map((_, i) => {
    const angle = i * 0.7;
    const radius = 2 + i * 2.6; // percent units
    return {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius * 0.75, // flatten slightly for widescreen
    };
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
