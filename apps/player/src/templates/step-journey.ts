import type { Template, TemplateHandle } from './registry';

/**
 * step-journey — a horizontal progress walkthrough showing a user journey
 * as labeled steps connected by a progress line. Each step lights up in
 * sequence (via stagger or beat-driven emphasize). Think subway map meets
 * wizard stepper.
 *
 * Rendering approach: full DOM. A flex row of step cards, each with an
 * icon/emoji circle, a label, and a detail line. A horizontal SVG or CSS
 * line connects the circles. Steps start muted (opacity ~0.3) and light
 * up to full opacity + activeColor border on reveal.
 *
 * Slot schema:
 *   title?:       string
 *   steps:        StepSpec[]           (recommended 3–7)
 *   activeColor?: string               (CSS color or "palette.primary")
 *   staggerMs?:   number               (delay between step reveals, default 1000)
 *
 * emphasize(target): target is the step index as a string ("0", "1", …).
 *   Lights up that step (and the connector leading into it).
 *   If steps were already stagger-revealed, emphasize adds a pulse/glow.
 */

// ── Content contract ────────────────────────────────────────────────

interface StepSpec {
  /** Emoji or short icon string shown in the circle. */
  icon: string;
  /** Short label below the icon (1–4 words). */
  label: string;
  /** Optional longer detail shown on hover or beneath the label. */
  detail?: string;
}

interface StepJourneyContent {
  title?: string;
  steps: StepSpec[];
  /** CSS color for the "active" state. Default: palette.primary. */
  activeColor?: string;
  /** Ms between each step lighting up. Default: 1000. */
  staggerMs?: number;
}

// ── Template export (implementation placeholder) ────────────────────

export const stepJourneyTemplate: Template = {
  id: 'step-journey',
  description:
    'Horizontal step-by-step user journey with icons, labels, and a connecting progress line. Steps light up in sequence.',
  slots: {
    title: 'string — optional headline above the journey',
    steps: '{ icon, label, detail? }[] — the journey steps (3–7 recommended)',
    activeColor: 'string — CSS color for lit-up steps (default palette.primary)',
    staggerMs: 'number — delay between step reveals (default 1000)',
  },
  demo: {
    label: 'Step Journey',
    content: {
      title: 'From sign-up to first value',
      steps: [
        { icon: '👋', label: 'Land on site', detail: 'Hero + one CTA' },
        { icon: '📝', label: 'Sign up', detail: 'Email + password' },
        { icon: '✉️', label: 'Verify email', detail: 'Click the link' },
        { icon: '⚙️', label: 'Configure', detail: 'Pick a template' },
        { icon: '🎉', label: 'First win', detail: 'Presentation plays' },
      ],
      staggerMs: 900,
    },
    emphasizeAfter: { target: '4', delayMs: 5200 },
  },

  render(presenter, contentIn): TemplateHandle {
    const c = contentIn as unknown as StepJourneyContent;
    const steps = c.steps ?? [];
    const staggerMs = c.staggerMs ?? 1000;
    const activeColor = c.activeColor ?? '#3b82f6';

    // ── DOM container ──────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'sb-step-journey';
    // Per-instance theming: active color and per-step transition pacing flow
    // through CSS custom properties so the static classes can stay generic.
    wrapper.style.setProperty('--sb-step-active', activeColor);
    wrapper.style.setProperty('--sb-step-reveal-ms', `${Math.round(staggerMs * 0.5)}ms`);

    // Optional title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.className = 'sb-step-journey-title';
      titleEl.textContent = c.title;
      wrapper.appendChild(titleEl);
    }

    // ── Step row ───────────────────────────────────────────────────
    const row = document.createElement('div');
    row.className = 'sb-step-journey-row';

    const stepEls: HTMLElement[] = [];
    const circleEls: HTMLElement[] = [];
    const connectorEls: HTMLElement[] = [];

    steps.forEach((step, i) => {
      // ── Connector line (before each step except the first) ─────
      if (i > 0) {
        const connector = document.createElement('div');
        connector.className = 'sb-step-journey-connector';
        connectorEls.push(connector);
        row.appendChild(connector);
      }

      // ── Step card ──────────────────────────────────────────────
      const card = document.createElement('div');
      card.className = 'sb-step-journey-card';

      const circle = document.createElement('div');
      circle.className = 'sb-step-journey-circle';
      circle.textContent = step.icon;
      card.appendChild(circle);

      const label = document.createElement('div');
      label.className = 'sb-step-journey-label';
      label.textContent = step.label;
      card.appendChild(label);

      if (step.detail) {
        const detail = document.createElement('div');
        detail.className = 'sb-step-journey-detail';
        detail.textContent = step.detail;
        card.appendChild(detail);
      }

      stepEls.push(card);
      circleEls.push(circle);
      row.appendChild(card);
    });

    wrapper.appendChild(row);
    presenter.domRoot.appendChild(wrapper);

    // ── Stagger reveal ─────────────────────────────────────────────
    const timers: number[] = [];

    const revealStep = (index: number) => {
      const card = stepEls[index];
      if (!card) return;
      card.classList.add('sb-visible');
      // Light up the connector leading into this step
      if (index > 0 && connectorEls[index - 1]) {
        connectorEls[index - 1].classList.add('sb-visible');
      }
    };

    steps.forEach((_, i) => {
      timers.push(window.setTimeout(() => revealStep(i), i * staggerMs));
    });

    // ── Handle ─────────────────────────────────────────────────────
    return {
      dismiss() {
        timers.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize(target: string) {
        const idx = parseInt(target, 10);
        if (Number.isNaN(idx) || !circleEls[idx]) return;
        // Ensure the step is revealed
        revealStep(idx);
        // Pulse the circle via the emphasize class (CSS handles the glow).
        const circle = circleEls[idx];
        circle.classList.add('sb-emphasize');
        timers.push(
          window.setTimeout(() => circle.classList.remove('sb-emphasize'), 1200),
        );
      },
    };
  },
};
