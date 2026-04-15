import type { Template, TemplateHandle } from './registry';

/**
 * data-pipeline — shows data flowing through transformation stages,
 * with ACTUAL VALUES visible at each step. Unlike transform-grid (which
 * shows abstract stage labels), this renders the data itself — arrays of
 * objects becoming filtered, mapped, reduced, enriched.
 *
 * Rendering approach: full DOM. A vertical or horizontal chain of "stage
 * cards." Each card has a header (operation label) and a body that
 * renders the stage's result data in one of several display modes:
 *   - "table"     → mini table with column headers
 *   - "value"     → single key:value (for reduce results)
 *   - "breakdown" → labeled rows like a receipt (subtotal, discount, total)
 *
 * An animated chevron/arrow connects each stage. Stages stagger in.
 * When a stage reveals, its data rows animate in with a short cascade.
 *
 * The `highlight` field in a stage marks which column or key should
 * pulse/glow when that stage is current — so you can see "this is the
 * new value that this step produced."
 *
 * Slot schema:
 *   title?:     string
 *   input:      InputSpec            (the starting data)
 *   stages:     StageSpec[]          (2–5 transformation stages)
 *   staggerMs?: number               (delay between stages, default 1500)
 *
 * emphasize(target): target is the stage index as a string ("0", "1", …).
 *   Input block is NOT indexed — stage "0" is the first transformation.
 *   Emphasize scrolls/highlights that stage and pulses its highlight field.
 */

// ── Content contract ────────────────────────────────────────────────

type DisplayMode = 'table' | 'value' | 'breakdown';

interface InputSpec {
  /** Label above the input block, e.g. "Line Items". */
  label: string;
  /** The raw data. Array of objects for table mode, or a single object. */
  data: Record<string, unknown>[] | Record<string, unknown>;
  /** How to render the input data. Default: "table". */
  display?: DisplayMode;
}

interface StageSpec {
  /** Short operation description, e.g. "map → multiply" or "reduce → sum". */
  operation: string;
  /** Human-readable label, e.g. "Calculate each line total". */
  label: string;
  /** The data AFTER this stage runs. Shape depends on display mode. */
  result: Record<string, unknown>[] | Record<string, unknown>;
  /** Which key to visually highlight in the result (the "new" value). */
  highlight?: string;
  /** How to render this stage's result. Default: "table". */
  display?: DisplayMode;
}

interface DataPipelineContent {
  title?: string;
  input: InputSpec;
  stages: StageSpec[];
  /** Ms between each stage revealing. Default: 1500. */
  staggerMs?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function renderDataBlock(
  data: Record<string, unknown>[] | Record<string, unknown>,
  mode: DisplayMode,
  highlight?: string,
): HTMLElement {
  const block = document.createElement('div');
  Object.assign(block.style, {
    fontSize: '13px',
    lineHeight: '1.6',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  });

  if (mode === 'table' && Array.isArray(data)) {
    const table = document.createElement('table');
    Object.assign(table.style, {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '12px',
    });

    // Header row from first item's keys
    if (data.length > 0) {
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      Object.keys(data[0]).forEach((key) => {
        const th = document.createElement('th');
        th.textContent = key;
        Object.assign(th.style, {
          textAlign: 'left',
          padding: '4px 8px',
          borderBottom: '1px solid #334155',
          color: '#94a3b8',
          fontWeight: '500',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        });
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
    }

    // Data rows
    const tbody = document.createElement('tbody');
    data.forEach((row) => {
      const tr = document.createElement('tr');
      Object.entries(row).forEach(([key, val]) => {
        const td = document.createElement('td');
        td.textContent = String(val);
        Object.assign(td.style, {
          padding: '4px 8px',
          borderBottom: '1px solid #1e293b',
          color: key === highlight ? '#f59e0b' : '#e2e8f0',
          fontWeight: key === highlight ? '700' : '400',
        });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
  } else if (mode === 'value') {
    // Single key:value (e.g. { subtotal: 2600 })
    const obj = Array.isArray(data) ? data[0] ?? {} : data;
    Object.entries(obj).forEach(([key, val]) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 0',
        fontSize: '20px',
        fontWeight: key === highlight ? '700' : '600',
        color: key === highlight ? '#f59e0b' : '#f8fafc',
      });
      const kSpan = document.createElement('span');
      kSpan.textContent = key;
      kSpan.style.color = '#94a3b8';
      kSpan.style.fontSize = '14px';
      kSpan.style.alignSelf = 'center';
      const vSpan = document.createElement('span');
      vSpan.textContent = typeof val === 'number' ? val.toLocaleString() : String(val);
      row.appendChild(kSpan);
      row.appendChild(vSpan);
      block.appendChild(row);
    });
  } else {
    // "breakdown" — receipt-style rows
    const obj = Array.isArray(data) ? data[0] ?? {} : data;
    Object.entries(obj).forEach(([key, val]) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 0',
        borderBottom: '1px solid #1e293b',
        color: key === highlight ? '#f59e0b' : '#e2e8f0',
        fontWeight: key === highlight ? '700' : '400',
      });
      const kSpan = document.createElement('span');
      kSpan.textContent = key;
      const vSpan = document.createElement('span');
      vSpan.textContent = typeof val === 'number' ? val.toLocaleString() : String(val);
      row.appendChild(kSpan);
      row.appendChild(vSpan);
      block.appendChild(row);
    });
  }

  return block;
}

// ── Template export ─────────────────────────────────────────────────

export const dataPipelineTemplate: Template = {
  id: 'data-pipeline',
  description:
    'Animated data transformation pipeline showing actual values flowing through stages (map, filter, reduce, etc.).',
  slots: {
    title: 'string — optional headline',
    input: '{ label, data, display? } — the starting data',
    stages:
      '{ operation, label, result, highlight?, display? }[] — transformation stages (2–5)',
    staggerMs: 'number — delay between stage reveals (default 1500)',
  },
  demo: {
    label: 'Data Pipeline',
    content: {
      title: 'Checkout math',
      input: {
        label: 'Line Items',
        display: 'table',
        data: [
          { sku: 'A1', qty: 2, price: 12 },
          { sku: 'B3', qty: 1, price: 30 },
          { sku: 'C7', qty: 3, price: 5 },
        ],
      },
      stages: [
        {
          operation: 'map → qty × price',
          label: 'Line totals',
          display: 'table',
          highlight: 'total',
          result: [
            { sku: 'A1', qty: 2, price: 12, total: 24 },
            { sku: 'B3', qty: 1, price: 30, total: 30 },
            { sku: 'C7', qty: 3, price: 5, total: 15 },
          ],
        },
        {
          operation: 'reduce → sum(total)',
          label: 'Subtotal',
          display: 'value',
          highlight: 'subtotal',
          result: { subtotal: 69 },
        },
        {
          operation: 'apply discount + tax',
          label: 'Grand total',
          display: 'breakdown',
          highlight: 'total',
          result: { subtotal: 69, discount: -5, tax: 5.76, total: 69.76 },
        },
      ],
      staggerMs: 1400,
    },
    emphasizeAfter: { target: '2', delayMs: 4600 },
  },

  render(presenter, contentIn): TemplateHandle {
    const c = contentIn as unknown as DataPipelineContent;
    const stages = c.stages ?? [];
    const staggerMs = c.staggerMs ?? 1500;

    // ── Outer wrapper ────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'data-pipeline';
    Object.assign(wrapper.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#f8fafc',
      overflowY: 'auto',
    });

    // Title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.textContent = c.title;
      Object.assign(titleEl.style, {
        fontSize: '22px',
        fontWeight: '700',
        marginBottom: '24px',
      });
      wrapper.appendChild(titleEl);
    }

    // ── Pipeline column ──────────────────────────────────────────
    const column = document.createElement('div');
    Object.assign(column.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0',
      width: '100%',
      maxWidth: '520px',
    });

    const stageCards: HTMLElement[] = [];

    // Helper: create a stage card (used for input AND stages)
    const makeCard = (
      headerText: string,
      subText: string | undefined,
      data: Record<string, unknown>[] | Record<string, unknown>,
      display: DisplayMode,
      highlight?: string,
    ): HTMLElement => {
      const card = document.createElement('div');
      Object.assign(card.style, {
        width: '100%',
        background: '#1e293b',
        borderRadius: '10px',
        padding: '14px 18px',
        border: '1px solid #334155',
        opacity: '0',
        transform: 'translateY(12px)',
        transition: `opacity 500ms ease, transform 500ms ease, box-shadow 300ms ease`,
      });

      const header = document.createElement('div');
      Object.assign(header.style, {
        fontSize: '11px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: '#a855f7',
        marginBottom: subText ? '2px' : '10px',
      });
      header.textContent = headerText;
      card.appendChild(header);

      if (subText) {
        const sub = document.createElement('div');
        Object.assign(sub.style, {
          fontSize: '14px',
          fontWeight: '500',
          color: '#e2e8f0',
          marginBottom: '10px',
        });
        sub.textContent = subText;
        card.appendChild(sub);
      }

      card.appendChild(renderDataBlock(data, display, highlight));
      return card;
    };

    // Helper: chevron arrow between cards
    const makeArrow = (): HTMLElement => {
      const arrow = document.createElement('div');
      Object.assign(arrow.style, {
        fontSize: '18px',
        color: '#475569',
        padding: '4px 0',
        opacity: '0',
        transition: 'opacity 400ms ease',
      });
      arrow.textContent = '▼';
      return arrow;
    };

    // ── Input card ───────────────────────────────────────────────
    const inputCard = makeCard(
      c.input.label,
      undefined,
      c.input.data as any,
      c.input.display ?? 'table',
    );
    column.appendChild(inputCard);

    // ── Stage cards ──────────────────────────────────────────────
    const arrows: HTMLElement[] = [];

    stages.forEach((stage) => {
      const arrow = makeArrow();
      arrows.push(arrow);
      column.appendChild(arrow);

      const card = makeCard(
        stage.operation,
        stage.label,
        stage.result as any,
        stage.display ?? 'table',
        stage.highlight,
      );
      stageCards.push(card);
      column.appendChild(card);
    });

    wrapper.appendChild(column);
    presenter.domRoot.appendChild(wrapper);

    // ── Stagger reveal ─────────────────────────────────────────
    const timers: number[] = [];

    // Reveal input immediately
    requestAnimationFrame(() => {
      inputCard.style.opacity = '1';
      inputCard.style.transform = 'translateY(0)';
    });

    const revealStage = (index: number) => {
      if (arrows[index]) {
        arrows[index].style.opacity = '1';
      }
      if (stageCards[index]) {
        stageCards[index].style.opacity = '1';
        stageCards[index].style.transform = 'translateY(0)';
      }
    };

    stages.forEach((_, i) => {
      timers.push(window.setTimeout(() => revealStage(i), (i + 1) * staggerMs));
    });

    // ── Handle ─────────────────────────────────────────────────
    return {
      dismiss() {
        timers.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize(target: string) {
        const idx = parseInt(target, 10);
        if (Number.isNaN(idx) || !stageCards[idx]) return;
        // Ensure revealed
        revealStage(idx);
        // Pulse
        stageCards[idx].style.boxShadow = '0 0 24px rgba(168, 85, 247, 0.5)';
        setTimeout(() => {
          stageCards[idx].style.boxShadow = 'none';
        }, 1400);
      },
    };
  },
};
