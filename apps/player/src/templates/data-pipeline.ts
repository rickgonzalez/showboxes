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
  block.className = 'sb-pipeline-block';

  if (mode === 'table' && Array.isArray(data)) {
    const table = document.createElement('table');
    table.className = 'sb-pipeline-table';

    // Header row from first item's keys
    if (data.length > 0) {
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      Object.keys(data[0]).forEach((key) => {
        const th = document.createElement('th');
        th.className = 'sb-pipeline-th';
        th.textContent = key;
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
        td.className =
          key === highlight ? 'sb-pipeline-td sb-highlight' : 'sb-pipeline-td';
        td.textContent = String(val);
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
      row.className =
        key === highlight
          ? 'sb-pipeline-value-row sb-highlight'
          : 'sb-pipeline-value-row';
      const kSpan = document.createElement('span');
      kSpan.className = 'sb-pipeline-value-key';
      kSpan.textContent = key;
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
      row.className =
        key === highlight
          ? 'sb-pipeline-breakdown-row sb-highlight'
          : 'sb-pipeline-breakdown-row';
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
    wrapper.className = 'sb-pipeline-wrapper';

    // Title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.className = 'sb-pipeline-title';
      titleEl.textContent = c.title;
      wrapper.appendChild(titleEl);
    }

    // ── Pipeline column ──────────────────────────────────────────
    const column = document.createElement('div');
    column.className = 'sb-pipeline-column';

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
      card.className = 'sb-pipeline-card';

      const header = document.createElement('div');
      header.className = subText
        ? 'sb-pipeline-card-header sb-with-sub'
        : 'sb-pipeline-card-header';
      header.textContent = headerText;
      card.appendChild(header);

      if (subText) {
        const sub = document.createElement('div');
        sub.className = 'sb-pipeline-card-sub';
        sub.textContent = subText;
        card.appendChild(sub);
      }

      card.appendChild(renderDataBlock(data, display, highlight));
      return card;
    };

    // Helper: chevron arrow between cards
    const makeArrow = (): HTMLElement => {
      const arrow = document.createElement('div');
      arrow.className = 'sb-pipeline-arrow';
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
    requestAnimationFrame(() => inputCard.classList.add('sb-visible'));

    const revealStage = (index: number) => {
      arrows[index]?.classList.add('sb-visible');
      stageCards[index]?.classList.add('sb-visible');
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
        // Pulse via CSS class — see .sb-pipeline-card.sb-emphasize.
        const card = stageCards[idx];
        card.classList.add('sb-emphasize');
        timers.push(
          window.setTimeout(() => card.classList.remove('sb-emphasize'), 1400),
        );
      },
    };
  },
};
