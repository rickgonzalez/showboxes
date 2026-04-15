import Prism from 'prismjs';
import type { Template, TemplateHandle } from './registry';

/**
 * transform-grid — a horizontal sequence of panels showing data/concept
 * transforming through stages. Each stage is a card with a label; stages
 * reveal left-to-right with connector arrows between them. Good for
 * pipelines, refactor sequences, request/response flow.
 *
 * Slot schema:
 *   title:     string — optional canvas headline (currently shown in DOM)
 *   stages:    Stage[]
 *   staggerMs: number — delay between stage reveals (default 600)
 *   connector: "arrow" | "chevron" | "fade"
 */

interface StageDisplay {
  type: 'code' | 'text';
  code?: string;
  text?: string;
  language?: string;
}

interface StageSpec {
  label: string;
  display: StageDisplay;
}

interface TransformGridContent {
  title?: string;
  stages: StageSpec[];
  staggerMs?: number;
  connector?: 'arrow' | 'chevron' | 'fade';
}

const CONNECTORS: Record<string, string> = {
  arrow: '\u2192',    // →
  chevron: '\u276F',  // ❯
  fade: '\u2026',     // …
};

export const transformGridTemplate: Template = {
  id: 'transform-grid',
  description:
    'Horizontal pipeline of stages that reveal left-to-right with connector arrows. Stages can show code or text.',
  slots: {
    title: 'string — optional headline above the grid',
    stages: '{ label: string, display: { type: "code"|"text", code?, text?, language? } }[]',
    staggerMs: 'number — delay between stage reveals (default 600)',
    connector: '"arrow" | "chevron" | "fade"',
  },
  demo: {
    label: 'Transform Grid',
    content: {
      title: 'How a request becomes a response',
      stages: [
        {
          label: 'Raw Request',
          display: {
            type: 'code',
            code: 'POST /api/login\n{email, password}',
            language: 'http',
          },
        },
        {
          label: 'Validated',
          display: {
            type: 'code',
            code: "{ email: 'rick@...',\n  password: '••••' }",
            language: 'json',
          },
        },
        {
          label: 'Authenticated',
          display: {
            type: 'text',
            text: '✓ Credentials match\n→ Generate JWT',
          },
        },
        {
          label: 'Response',
          display: {
            type: 'code',
            code: "200 OK\n{ token: 'eyJhbG...' }",
            language: 'http',
          },
        },
      ],
      staggerMs: 600,
      connector: 'arrow',
    },
    emphasizeAfter: { target: '2', delayMs: 3200 },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as TransformGridContent;
    const {
      title,
      stages = [],
      staggerMs = 600,
      connector = 'arrow',
    } = content;

    const wrapper = document.createElement('div');
    wrapper.className = 'sb-transform-wrapper';

    if (title) {
      const h = document.createElement('div');
      h.className = 'sb-transform-title';
      h.textContent = title;
      wrapper.appendChild(h);
    }

    const grid = document.createElement('div');
    grid.className = 'sb-transform-grid';
    wrapper.appendChild(grid);

    const stageEls: HTMLElement[] = [];
    const connectorEls: HTMLElement[] = [];

    stages.forEach((stage, i) => {
      const card = document.createElement('div');
      card.className = 'sb-transform-stage';

      const display = document.createElement('div');
      display.className = 'sb-transform-display';

      if (stage.display.type === 'code') {
        const pre = document.createElement('pre');
        pre.className = 'sb-transform-code';
        const code = document.createElement('code');
        const lang = stage.display.language ?? 'javascript';
        const grammar = Prism.languages[lang] ?? Prism.languages.javascript;
        const raw = stage.display.code ?? '';
        code.innerHTML = grammar ? Prism.highlight(raw, grammar, lang) : escapeHtml(raw);
        pre.appendChild(code);
        display.appendChild(pre);
      } else {
        const text = document.createElement('div');
        text.className = 'sb-transform-text';
        text.textContent = stage.display.text ?? '';
        display.appendChild(text);
      }

      card.appendChild(display);

      const label = document.createElement('div');
      label.className = 'sb-transform-label';
      label.textContent = stage.label;
      card.appendChild(label);

      grid.appendChild(card);
      stageEls.push(card);

      // Connector between this card and the next one.
      if (i < stages.length - 1) {
        const conn = document.createElement('div');
        conn.className = `sb-transform-connector sb-transform-connector-${connector}`;
        conn.textContent = CONNECTORS[connector] ?? CONNECTORS.arrow;
        grid.appendChild(conn);
        connectorEls.push(conn);
      }
    });

    presenter.domRoot.appendChild(wrapper);

    // Stagger reveal: stage, then its connector, then next stage.
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    stageEls.forEach((el, i) => {
      const t1 = setTimeout(() => el.classList.add('sb-visible'), 200 + i * staggerMs);
      timeouts.push(t1);
      const conn = connectorEls[i];
      if (conn) {
        const t2 = setTimeout(
          () => conn.classList.add('sb-visible'),
          200 + i * staggerMs + staggerMs * 0.55
        );
        timeouts.push(t2);
      }
    });

    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize: (target) => {
        const i = Number(target);
        const match = Number.isFinite(i)
          ? stageEls[i]
          : stageEls.find((el) =>
              el.querySelector('.sb-transform-label')?.textContent === target
            );
        if (match) {
          match.classList.add('sb-transform-active');
          setTimeout(() => match.classList.remove('sb-transform-active'), 1600);
        }
      },
    };
    return handle;
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
