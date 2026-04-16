import type { Template, TemplateHandle } from './registry';

/**
 * entity-map — a friendly entity-relationship diagram. Models/tables
 * render as rounded cards showing an icon, a label, and a short field
 * list. Relationship lines connect them with plain-English labels like
 * "has many" or "belongs to" instead of crow's-foot notation.
 *
 * Rendering approach: DOM cards for entities + SVG overlay for
 * relationship lines. Cards are positioned via a simple hierarchical or
 * force-directed layout (Phase 0: manual grid; later: auto-layout).
 *
 * The layout algorithm for Phase 0:
 *   - Entities are placed on a CSS grid (2–3 columns).
 *   - SVG lines are drawn between card center-points after layout.
 *   - Relationship labels sit at the midpoint of each line.
 *
 * Slot schema:
 *   title?:          string
 *   entities:        EntitySpec[]           (3–10 entities)
 *   relationships:   RelationshipSpec[]     (edges between entities)
 *   staggerMs?:      number                 (delay between card reveals, default 300)
 *   layout?:         "grid" | "hierarchical" (default "grid" for Phase 0)
 *
 * emphasize(target): target is an entity id string.
 *   Pulses the matching card and highlights all relationship lines
 *   connected to that entity.
 */

// ── Content contract ────────────────────────────────────────────────

interface EntitySpec {
  /** Unique id, referenced by relationships. */
  id: string;
  /** Display name. */
  label: string;
  /** Emoji or short icon string. */
  icon?: string;
  /** Key field names shown inside the card. */
  fields?: string[];
  /** CSS color or palette reference for the card border. */
  color?: string;
}

type RelType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

interface RelationshipSpec {
  /** Source entity id. */
  from: string;
  /** Target entity id. */
  to: string;
  /** Plain-English label, e.g. "has many", "belongs to". */
  label: string;
  /** Cardinality hint — affects line decoration (optional in Phase 0). */
  type?: RelType;
}

interface EntityMapContent {
  title?: string;
  entities: EntitySpec[];
  relationships: RelationshipSpec[];
  staggerMs?: number;
  layout?: 'grid' | 'hierarchical';
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Cardinality decoration glyphs for line endpoints. */
const CARDINALITY: Record<RelType, { fromMark: string; toMark: string }> = {
  'one-to-one': { fromMark: '1', toMark: '1' },
  'one-to-many': { fromMark: '1', toMark: 'N' },
  'many-to-one': { fromMark: 'N', toMark: '1' },
  'many-to-many': { fromMark: 'N', toMark: 'N' },
};

// ── Template export ─────────────────────────────────────────────────

export const entityMapTemplate: Template = {
  id: 'entity-map',
  description:
    'Friendly ER diagram: model cards with icons and fields, connected by labeled relationship lines.',
  slots: {
    title: 'string — optional headline',
    entities: '{ id, label, icon?, fields?, color? }[] — the models/tables (3–10)',
    relationships:
      '{ from, to, label, type? }[] — connections between entities',
    staggerMs: 'number — delay between card reveals (default 300)',
    layout: '"grid" | "hierarchical" — layout strategy (default "grid")',
  },
  demo: {
    label: 'Entity Map',
    content: {
      title: 'Data model at a glance',
      entities: [
        { id: 'user', label: 'User', icon: '👤', fields: ['id', 'email', 'name'] },
        { id: 'org', label: 'Organization', icon: '🏢', fields: ['id', 'name', 'plan'] },
        {
          id: 'project',
          label: 'Project',
          icon: '📁',
          fields: ['id', 'name', 'orgId'],
        },
        {
          id: 'presentation',
          label: 'Presentation',
          icon: '🎬',
          fields: ['id', 'projectId', 'script'],
        },
      ],
      relationships: [
        { from: 'org', to: 'user', label: 'has many', type: 'one-to-many' },
        { from: 'org', to: 'project', label: 'has many', type: 'one-to-many' },
        {
          from: 'project',
          to: 'presentation',
          label: 'has many',
          type: 'one-to-many',
        },
      ],
      staggerMs: 300,
    },
    emphasizeAfter: { target: 'project', delayMs: 2800 },
  },

  render(presenter, contentIn): TemplateHandle {
    const c = contentIn as unknown as EntityMapContent;
    const entities = c.entities ?? [];
    const relationships = c.relationships ?? [];
    const staggerMs = c.staggerMs ?? 300;

    const DEFAULT_COLOR = '#3b82f6';

    // ── Wrapper ──────────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'sb-entity-map-wrapper';

    // Title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.className = 'sb-entity-map-title';
      titleEl.textContent = c.title;
      wrapper.appendChild(titleEl);
    }

    // ── Layout container (relative, so SVG overlay can be absolute) ─
    const container = document.createElement('div');
    container.className = 'sb-entity-map-container';

    // ── Entity grid ──────────────────────────────────────────────
    const cols = entities.length <= 4 ? 2 : entities.length <= 6 ? 3 : 4;
    const grid = document.createElement('div');
    grid.className = 'sb-entity-map-grid';
    grid.style.setProperty('--sb-entity-cols', String(cols));

    const cardMap = new Map<string, HTMLElement>();
    const timers: number[] = [];

    entities.forEach((entity, i) => {
      const color = entity.color ?? DEFAULT_COLOR;
      const card = document.createElement('div');
      card.className = 'sb-entity-map-card';
      // Per-entity color drives both the border and the emphasize halo.
      card.style.setProperty('--sb-entity-color', color);
      card.style.setProperty('--sb-entity-glow', `${color}66`);

      // Icon + label row
      const header = document.createElement('div');
      header.className = entity.fields?.length
        ? 'sb-entity-map-header sb-with-fields'
        : 'sb-entity-map-header';
      if (entity.icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'sb-entity-map-icon';
        iconEl.textContent = entity.icon;
        header.appendChild(iconEl);
      }
      const labelEl = document.createElement('span');
      labelEl.className = 'sb-entity-map-label';
      labelEl.textContent = entity.label;
      header.appendChild(labelEl);
      card.appendChild(header);

      // Field list
      if (entity.fields?.length) {
        const fieldList = document.createElement('div');
        fieldList.className = entity.icon
          ? 'sb-entity-map-fields sb-with-icon'
          : 'sb-entity-map-fields';
        fieldList.textContent = entity.fields.join(', ');
        card.appendChild(fieldList);
      }

      cardMap.set(entity.id, card);
      grid.appendChild(card);

      // Stagger reveal
      timers.push(
        window.setTimeout(() => card.classList.add('sb-visible'), i * staggerMs),
      );
    });

    container.appendChild(grid);

    // ── SVG overlay for relationship lines ────────────────────────
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sb-entity-map-svg');
    container.appendChild(svg);

    wrapper.appendChild(container);
    presenter.domRoot.appendChild(wrapper);

    // ── Draw relationship lines (after layout settles) ───────────
    const lineEls: SVGElement[] = [];
    const linesByEntity = new Map<string, SVGElement[]>();

    const drawLines = () => {
      // Clear existing
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      lineEls.length = 0;
      linesByEntity.clear();

      const containerRect = container.getBoundingClientRect();

      relationships.forEach((rel) => {
        const fromCard = cardMap.get(rel.from);
        const toCard = cardMap.get(rel.to);
        if (!fromCard || !toCard) return;

        const fromRect = fromCard.getBoundingClientRect();
        const toRect = toCard.getBoundingClientRect();

        const x1 = fromRect.left - containerRect.left + fromRect.width / 2;
        const y1 = fromRect.top - containerRect.top + fromRect.height / 2;
        const x2 = toRect.left - containerRect.left + toRect.width / 2;
        const y2 = toRect.top - containerRect.top + toRect.height / 2;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        // Line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', '#475569');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '6 4');
        g.appendChild(line);

        // Midpoint label
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(mx));
        text.setAttribute('y', String(my - 6));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#94a3b8');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        text.textContent = rel.label;

        // Background rect for readability
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', String(mx - rel.label.length * 3.3 - 4));
        bg.setAttribute('y', String(my - 18));
        bg.setAttribute('width', String(rel.label.length * 6.6 + 8));
        bg.setAttribute('height', '16');
        bg.setAttribute('rx', '3');
        bg.setAttribute('fill', '#0f172a');
        g.appendChild(bg);
        g.appendChild(text);

        // Cardinality marks
        if (rel.type) {
          const marks = CARDINALITY[rel.type];
          if (marks) {
            const addMark = (x: number, y: number, mark: string) => {
              const m = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              m.setAttribute('x', String(x));
              m.setAttribute('y', String(y));
              m.setAttribute('text-anchor', 'middle');
              m.setAttribute('fill', '#64748b');
              m.setAttribute('font-size', '10');
              m.setAttribute('font-weight', '700');
              m.setAttribute('font-family', 'Inter, system-ui, sans-serif');
              m.textContent = mark;
              g.appendChild(m);
            };
            // Place marks at ~20% and ~80% along the line
            addMark(x1 + (x2 - x1) * 0.2, y1 + (y2 - y1) * 0.2 - 8, marks.fromMark);
            addMark(x1 + (x2 - x1) * 0.8, y1 + (y2 - y1) * 0.8 - 8, marks.toMark);
          }
        }

        svg.appendChild(g);
        lineEls.push(g);

        // Index lines by entity for emphasize
        [rel.from, rel.to].forEach((eid) => {
          if (!linesByEntity.has(eid)) linesByEntity.set(eid, []);
          linesByEntity.get(eid)!.push(g);
        });
      });
    };

    // Draw after a brief layout settle
    timers.push(
      window.setTimeout(drawLines, entities.length * staggerMs + 200),
    );

    // ── Handle ─────────────────────────────────────────────────
    return {
      dismiss() {
        timers.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize(target: string) {
        // target is an entity id
        const card = cardMap.get(target);
        if (!card) return;

        // Pulse the card via CSS class — halo color comes from
        // `--sb-entity-glow` set when the card was built.
        card.classList.add('sb-emphasize');
        timers.push(
          window.setTimeout(() => card.classList.remove('sb-emphasize'), 1400),
        );

        // Highlight connected lines (SVG attributes — kept inline).
        const lines = linesByEntity.get(target) ?? [];
        lines.forEach((g) => {
          const line = g.querySelector('line');
          if (line) {
            line.setAttribute('stroke', '#f59e0b');
            line.setAttribute('stroke-width', '3');
            timers.push(
              window.setTimeout(() => {
                line.setAttribute('stroke', '#475569');
                line.setAttribute('stroke-width', '2');
              }, 1400),
            );
          }
        });
      },
    };
  },
};
