import type { Template, TemplateHandle } from './registry';
import { PALETTE_DEFAULTS, resolveColor } from './palette';

/**
 * compare-split — side-by-side comparison of two parallel options.
 *
 * Use for: mode/approach contrasts, analogy panels ("like X vs Y"),
 * tradeoff displays, before/after. Unlike transform-grid (which implies
 * a sequential pipeline), compare-split shows two things that exist in
 * parallel — the divider communicates relationship, not flow.
 *
 * Slot schema:
 *   title:    string — optional headline above the split
 *   left:     Panel  — left-hand option
 *   right:    Panel  — right-hand option
 *   divider:  "vs" | "or" | "→" | "none"  (default "vs")
 *   staggerMs: number — delay between left/right/divider reveals (default 400)
 *
 * Panel:
 *   heading: string
 *   icon?:   string — short label or emoji shown above heading
 *   bullets: string[]
 *   accent?: string — CSS color or "palette.primary|secondary|accent"
 */

interface PanelSpec {
  heading: string;
  icon?: string;
  bullets?: string[];
  accent?: string;
}

interface CompareSplitContent {
  title?: string;
  left: PanelSpec;
  right: PanelSpec;
  divider?: 'vs' | 'or' | '→' | 'none';
  staggerMs?: number;
}

export const compareSplitTemplate: Template = {
  id: 'compare-split',
  description:
    'Side-by-side comparison of two parallel options with a divider. For mode contrasts, analogies, tradeoffs, before/after.',
  slots: {
    title: 'string — optional headline above the comparison',
    left: '{ heading, icon?, bullets?, accent? } — left panel',
    right: '{ heading, icon?, bullets?, accent? } — right panel',
    divider: '"vs" | "or" | "→" | "none" (default "vs")',
    staggerMs: 'number — delay between reveals (default 400)',
  },
  demo: {
    label: 'Compare Split',
    content: {
      title: 'Two Ways to Use It',
      left: {
        heading: 'Tag Mode',
        icon: '💬',
        bullets: [
          'Interactive: @claude in comments',
          'Full PR context',
          'Can push commits',
        ],
        accent: 'palette.primary',
      },
      right: {
        heading: 'Agent Mode',
        icon: '🤖',
        bullets: [
          'Automated: custom prompts',
          'Scheduled tasks',
          'Structured output',
        ],
        accent: 'palette.secondary',
      },
      divider: 'vs',
      staggerMs: 400,
    },
    emphasizeAfter: { target: 'right', delayMs: 2200 },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as CompareSplitContent;
    const {
      title,
      left,
      right,
      divider = 'vs',
      staggerMs = 400,
    } = content;

    const wrapper = document.createElement('div');
    wrapper.className = 'sb-compare-wrapper';

    if (title) {
      const h = document.createElement('div');
      h.className = 'sb-compare-title';
      h.textContent = title;
      wrapper.appendChild(h);
    }

    const row = document.createElement('div');
    row.className = 'sb-compare-row';
    if (divider === 'none') row.classList.add('sb-compare-row-nodivider');
    wrapper.appendChild(row);

    const leftEl = buildPanel(left, 'left', PALETTE_DEFAULTS['palette.primary']);
    const dividerEl =
      divider === 'none' ? null : buildDivider(divider);
    const rightEl = buildPanel(right, 'right', PALETTE_DEFAULTS['palette.secondary']);

    row.appendChild(leftEl);
    if (dividerEl) row.appendChild(dividerEl);
    row.appendChild(rightEl);

    presenter.domRoot.appendChild(wrapper);

    // Entrance: left + right slide in together, divider fades in between.
    // After that, everything holds still — no continuous motion.
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    timeouts.push(setTimeout(() => leftEl.classList.add('sb-visible'), 200));
    timeouts.push(setTimeout(() => rightEl.classList.add('sb-visible'), 200));
    if (dividerEl) {
      timeouts.push(
        setTimeout(() => dividerEl.classList.add('sb-visible'), 200 + staggerMs),
      );
    }

    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize: (target) => {
        const t = target?.toLowerCase();
        const match =
          t === 'left' ? leftEl : t === 'right' ? rightEl : null;
        if (match) {
          match.classList.add('sb-compare-active');
          setTimeout(() => match.classList.remove('sb-compare-active'), 1600);
        }
      },
    };
    return handle;
  },
};

function buildPanel(
  panel: PanelSpec,
  side: 'left' | 'right',
  fallbackAccent: string,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `sb-compare-panel sb-compare-panel-${side}`;
  const accent = resolveColor(panel.accent, fallbackAccent);
  card.style.setProperty('--sb-compare-accent', accent);

  if (panel.icon) {
    const icon = document.createElement('div');
    icon.className = 'sb-compare-icon';
    icon.textContent = panel.icon;
    card.appendChild(icon);
  }

  const heading = document.createElement('div');
  heading.className = 'sb-compare-heading';
  heading.textContent = panel.heading;
  card.appendChild(heading);

  if (panel.bullets && panel.bullets.length > 0) {
    const list = document.createElement('ul');
    list.className = 'sb-compare-bullets';
    for (const b of panel.bullets) {
      const li = document.createElement('li');
      li.textContent = b;
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  return card;
}

function buildDivider(kind: 'vs' | 'or' | '→'): HTMLElement {
  const el = document.createElement('div');
  el.className = `sb-compare-divider sb-compare-divider-${kind === '→' ? 'arrow' : kind}`;
  el.textContent = kind;
  return el;
}
