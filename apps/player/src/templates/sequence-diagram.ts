import type { Template, TemplateHandle } from './registry';

/**
 * sequence-diagram — a UML-style "sequence diagram for dummies":
 * up to ~5 vertical actor lanes across the top, dashed lifelines
 * dropping down, and labeled arrows drawn between lanes in time order.
 *
 * Arrows animate in (stroke-dashoffset draw-in), labels fade after the
 * line lands, and UML activation bars appear on the lane that is
 * "active" for each call — the thick vertical slab that shows a frame
 * is on the stack.
 *
 * Slot schema:
 *   title?:    string
 *   actors:    { id, label, icon? }[]                    (max 5 recommended)
 *   steps:     { from, to, label, kind }[]
 *              kind: "request" | "response" | "self" | "note"
 *              For kind="note", `to` is ignored; the note anchors on `from`.
 *   staggerMs: number — delay between step reveals (default 700)
 */

interface ActorSpec {
  id: string;
  label: string;
  icon?: string;
}

type StepKind = 'request' | 'response' | 'self' | 'note';

interface StepSpec {
  from: string;
  to?: string;
  label: string;
  kind?: StepKind;
}

interface SequenceDiagramContent {
  title?: string;
  actors: ActorSpec[];
  steps: StepSpec[];
  staggerMs?: number;
}

/* Layout constants — tuned for a stage ~960px wide. Tweak by feel. */
const HEADER_H = 72;          // height of the actor header row
const ROW_H = 64;              // vertical spacing between steps
const ROW_TOP_PAD = 24;        // gap between header and first step
const LABEL_FONT_PX = 13;

export const sequenceDiagramTemplate: Template = {
  id: 'sequence-diagram',
  description:
    'UML sequence diagram: actor lanes across the top, animated arrows between them showing who calls whom and in what order.',
  slots: {
    title: 'string — optional headline',
    actors: '{ id, label, icon? }[] — up to ~5 lanes',
    steps: '{ from, to, label, kind: "request"|"response"|"self"|"note" }[]',
    staggerMs: 'number — delay between arrow reveals (default 700)',
  },
  demo: {
    label: 'Sequence Diagram',
    content: {
      title: 'Login request',
      actors: [
        { id: 'user', label: 'User', icon: '👤' },
        { id: 'api', label: 'API', icon: '⚙' },
        { id: 'auth', label: 'Auth', icon: '🛡' },
        { id: 'db', label: 'DB', icon: '💾' },
      ],
      steps: [
        { from: 'user', to: 'api', label: 'POST /login', kind: 'request' },
        { from: 'api', to: 'auth', label: 'verify(password)', kind: 'request' },
        { from: 'auth', to: 'db', label: 'SELECT user', kind: 'request' },
        { from: 'db', to: 'auth', label: 'row', kind: 'response' },
        { from: 'auth', to: 'api', label: '✓ valid', kind: 'response' },
        { from: 'api', to: 'api', label: 'sign JWT', kind: 'self' },
        { from: 'api', to: 'user', label: '200 + token', kind: 'response' },
      ],
      staggerMs: 700,
    },
    emphasizeAfter: { target: '5', delayMs: 6200 },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as SequenceDiagramContent;
    const { title, actors = [], steps = [], staggerMs = 700 } = content;

    if (actors.length === 0) {
      // Degenerate — render an empty frame instead of crashing.
      const empty = document.createElement('div');
      empty.className = 'sb-seq-wrapper';
      presenter.domRoot.appendChild(empty);
      return { dismiss: () => empty.remove() };
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'sb-seq-wrapper';

    if (title) {
      const h = document.createElement('div');
      h.className = 'sb-seq-title';
      h.textContent = title;
      wrapper.appendChild(h);
    }

    // Grid geometry: one column per actor, rows = HEADER_H + steps * ROW_H.
    const cols = actors.length;
    const totalH = HEADER_H + ROW_TOP_PAD + steps.length * ROW_H + 40;

    const stage = document.createElement('div');
    stage.className = 'sb-seq-stage';
    stage.style.height = `${totalH}px`;
    wrapper.appendChild(stage);

    // --- Actor headers + lifelines --------------------------------------
    const actorEls: HTMLElement[] = [];
    const actorX: Record<string, number> = {};

    actors.forEach((actor, i) => {
      // Normalized x as percent — SVG will use the same fractions.
      const pct = ((i + 0.5) / cols) * 100;
      actorX[actor.id] = pct;

      const head = document.createElement('div');
      head.className = 'sb-seq-actor';
      head.style.left = `${pct}%`;
      head.dataset.actorId = actor.id;
      const inner = document.createElement('div');
      inner.className = 'sb-seq-actor-inner';
      inner.textContent = actor.icon ? `${actor.icon}  ${actor.label}` : actor.label;
      head.appendChild(inner);
      stage.appendChild(head);
      actorEls.push(head);

      // Lifeline — dashed vertical line from below the header to the bottom.
      const life = document.createElement('div');
      life.className = 'sb-seq-lifeline';
      life.style.left = `${pct}%`;
      life.style.top = `${HEADER_H}px`;
      life.style.height = `${totalH - HEADER_H - 12}px`;
      stage.appendChild(life);
    });

    // --- SVG overlay for arrows -----------------------------------------
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'sb-seq-svg');
    svg.setAttribute('viewBox', `0 0 1000 ${totalH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    stage.appendChild(svg);

    // Arrowhead marker defs.
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <marker id="sb-seq-arrow-req" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="#e6e8ee"/>
      </marker>
      <marker id="sb-seq-arrow-res" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="#94a3b8"/>
      </marker>
    `;
    svg.appendChild(defs);

    /**
     * Each step gets:
     *   - An SVG path (arrow or self-loop) with stroke-dasharray animation.
     *   - A DOM label absolutely positioned at midpoint (crisp text).
     *   - An activation bar on the `to` lane for request/response kinds.
     *   - A note block for kind="note".
     */
    const stepPaths: SVGPathElement[] = [];
    const stepLabels: HTMLElement[] = [];
    const stepActivations: HTMLElement[] = [];
    const stepRows: HTMLElement[] = []; // invisible row marker for emphasize

    steps.forEach((step, i) => {
      const kind: StepKind = step.kind ?? 'request';
      const y = HEADER_H + ROW_TOP_PAD + i * ROW_H + ROW_H / 2;

      // Invisible row for emphasize hit-testing.
      const row = document.createElement('div');
      row.className = 'sb-seq-row';
      row.style.top = `${HEADER_H + ROW_TOP_PAD + i * ROW_H}px`;
      row.style.height = `${ROW_H}px`;
      row.dataset.index = String(i);
      stage.appendChild(row);
      stepRows.push(row);

      if (kind === 'note') {
        const note = document.createElement('div');
        note.className = 'sb-seq-note';
        note.style.top = `${y - 14}px`;
        note.style.left = `${actorX[step.from] ?? 50}%`;
        note.textContent = step.label;
        stage.appendChild(note);
        stepLabels.push(note);
        // Placeholders to keep array indices aligned with `steps`.
        stepPaths.push(document.createElementNS(svgNS, 'path'));
        stepActivations.push(document.createElement('div'));
        return;
      }

      const fromPct = actorX[step.from];
      const toPct = actorX[step.to ?? step.from];
      if (fromPct == null || toPct == null) {
        // Silently skip malformed steps.
        stepPaths.push(document.createElementNS(svgNS, 'path'));
        stepLabels.push(document.createElement('div'));
        stepActivations.push(document.createElement('div'));
        return;
      }

      // SVG uses viewBox 0..1000 wide; map pct→svg-x.
      const xa = (fromPct / 100) * 1000;
      const xb = (toPct / 100) * 1000;

      const path = document.createElementNS(svgNS, 'path');
      let d: string;
      if (kind === 'self') {
        // Self-loop: right-hook that returns to the same lane a bit lower.
        const hook = 38; // how far right the hook extends (in svg units)
        const yBottom = y + 22;
        d = `M ${xa} ${y} h ${hook} v ${yBottom - y} h -${hook}`;
      } else {
        d = `M ${xa} ${y} L ${xb} ${y}`;
      }
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('class', `sb-seq-arrow sb-seq-arrow-${kind}`);
      path.setAttribute(
        'marker-end',
        kind === 'response' ? 'url(#sb-seq-arrow-res)' : 'url(#sb-seq-arrow-req)'
      );
      svg.appendChild(path);
      stepPaths.push(path);

      // Label — anchored at midpoint of the arrow.
      const label = document.createElement('div');
      label.className = `sb-seq-label sb-seq-label-${kind}`;
      label.style.fontSize = `${LABEL_FONT_PX}px`;
      label.textContent = step.label;
      const midPct = kind === 'self' ? (fromPct + 3.5) : (fromPct + toPct) / 2;
      label.style.left = `${midPct}%`;
      label.style.top = `${y - 22}px`;
      stage.appendChild(label);
      stepLabels.push(label);

      // Activation bar on the *receiver* lane (the callee is "on the stack").
      // For responses, the bar briefly marks the returning lane.
      const activation = document.createElement('div');
      activation.className = `sb-seq-activation sb-seq-activation-${kind}`;
      activation.style.left = `${actorX[step.to ?? step.from]}%`;
      activation.style.top = `${y - 4}px`;
      activation.style.height = `${ROW_H - 8}px`;
      stage.appendChild(activation);
      stepActivations.push(activation);
    });

    presenter.domRoot.appendChild(wrapper);

    // --- Entrance animation --------------------------------------------
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Actors pop in fast, all before any step fires.
    actorEls.forEach((el, i) => {
      const tid = setTimeout(() => el.classList.add('sb-visible'), 80 + i * 90);
      timeouts.push(tid);
    });

    const baseDelay = 80 + actorEls.length * 90 + 120;

    steps.forEach((step, i) => {
      const when = baseDelay + i * staggerMs;
      const path = stepPaths[i];
      const label = stepLabels[i];
      const activation = stepActivations[i];

      const tid = setTimeout(() => {
        // Prepare the stroke-dashoffset draw-in.
        if (path && path.getTotalLength) {
          try {
            const len = path.getTotalLength();
            if (len > 0) {
              path.style.strokeDasharray = `${len}`;
              path.style.strokeDashoffset = `${len}`;
              // Force reflow so the transition picks up the start state.
              void path.getBoundingClientRect();
              path.style.transition = 'stroke-dashoffset 420ms ease-out';
              path.style.strokeDashoffset = '0';
            }
          } catch {
            // getTotalLength can throw on unattached nodes — ignore.
          }
        }
        path?.classList.add('sb-visible');
        // Label fades in slightly after the line lands.
        const labelTid = setTimeout(() => label?.classList.add('sb-visible'), 260);
        timeouts.push(labelTid);
        // Activation bar fades in with the label.
        if (step.kind !== 'note') {
          const actTid = setTimeout(
            () => activation?.classList.add('sb-visible'),
            260
          );
          timeouts.push(actTid);
        }
      }, when);
      timeouts.push(tid);
    });

    // --- Handle --------------------------------------------------------
    const handle: TemplateHandle = {
      dismiss: () => {
        timeouts.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize: (target) => {
        // Numeric target → step index. String → actor id.
        const idx = Number(target);
        if (Number.isFinite(idx) && stepRows[idx]) {
          const path = stepPaths[idx];
          const label = stepLabels[idx];
          const activation = stepActivations[idx];
          path?.classList.add('sb-seq-pulse');
          label?.classList.add('sb-seq-pulse');
          activation?.classList.add('sb-seq-pulse');
          setTimeout(() => {
            path?.classList.remove('sb-seq-pulse');
            label?.classList.remove('sb-seq-pulse');
            activation?.classList.remove('sb-seq-pulse');
          }, 1600);
          return;
        }
        const actor = actorEls.find((el) => el.dataset.actorId === target);
        if (actor) {
          actor.classList.add('sb-seq-actor-active');
          setTimeout(() => actor.classList.remove('sb-seq-actor-active'), 1800);
        }
      },
    };
    return handle;
  },
};
