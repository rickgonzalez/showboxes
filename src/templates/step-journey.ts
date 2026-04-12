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

  render(presenter, contentIn): TemplateHandle {
    const c = contentIn as unknown as StepJourneyContent;
    const steps = c.steps ?? [];
    const staggerMs = c.staggerMs ?? 1000;
    const activeColor = c.activeColor ?? '#3b82f6';

    // ── DOM container ──────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'step-journey';
    Object.assign(wrapper.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#f8fafc',
    });

    // Optional title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.textContent = c.title;
      Object.assign(titleEl.style, {
        fontSize: '24px',
        fontWeight: '700',
        marginBottom: '40px',
        textAlign: 'center',
      });
      wrapper.appendChild(titleEl);
    }

    // ── Step row ───────────────────────────────────────────────────
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: '0',
      width: '100%',
      maxWidth: '900px',
      position: 'relative',
    });

    const stepEls: HTMLElement[] = [];
    const connectorEls: HTMLElement[] = [];

    steps.forEach((step, i) => {
      // ── Connector line (before each step except the first) ─────
      if (i > 0) {
        const connector = document.createElement('div');
        Object.assign(connector.style, {
          flex: '1',
          height: '3px',
          background: '#334155',
          alignSelf: 'center',
          marginTop: '20px', // vertically center with the icon circle
          transition: `background ${staggerMs * 0.4}ms ease`,
          opacity: '0.3',
        });
        connectorEls.push(connector);
        row.appendChild(connector);
      }

      // ── Step card ──────────────────────────────────────────────
      const card = document.createElement('div');
      Object.assign(card.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: '80px',
        maxWidth: '120px',
        opacity: '0.25',
        transform: 'translateY(8px)',
        transition: `opacity ${staggerMs * 0.5}ms ease, transform ${staggerMs * 0.5}ms ease, filter 300ms ease`,
      });

      const circle = document.createElement('div');
      Object.assign(circle.style, {
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: `3px solid #334155`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '20px',
        marginBottom: '8px',
        transition: `border-color ${staggerMs * 0.4}ms ease, box-shadow 300ms ease`,
        background: '#1e293b',
      });
      circle.textContent = step.icon;
      card.appendChild(circle);

      const label = document.createElement('div');
      Object.assign(label.style, {
        fontSize: '13px',
        fontWeight: '600',
        textAlign: 'center',
        lineHeight: '1.3',
        marginBottom: '4px',
      });
      label.textContent = step.label;
      card.appendChild(label);

      if (step.detail) {
        const detail = document.createElement('div');
        Object.assign(detail.style, {
          fontSize: '11px',
          color: '#94a3b8',
          textAlign: 'center',
          lineHeight: '1.3',
        });
        detail.textContent = step.detail;
        card.appendChild(detail);
      }

      // Store circle ref for emphasize
      (card as any).__circle = circle;

      stepEls.push(card);
      row.appendChild(card);
    });

    wrapper.appendChild(row);
    presenter.domRoot.appendChild(wrapper);

    // ── Stagger reveal ─────────────────────────────────────────────
    const timers: number[] = [];

    const revealStep = (index: number) => {
      const card = stepEls[index];
      if (!card) return;
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
      const circle = (card as any).__circle as HTMLElement;
      circle.style.borderColor = activeColor;

      // Light up the connector leading into this step
      if (index > 0 && connectorEls[index - 1]) {
        connectorEls[index - 1].style.background = activeColor;
        connectorEls[index - 1].style.opacity = '1';
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
        if (Number.isNaN(idx) || !stepEls[idx]) return;
        // Ensure the step is revealed
        revealStep(idx);
        // Pulse the circle
        const circle = (stepEls[idx] as any).__circle as HTMLElement;
        circle.style.boxShadow = `0 0 20px ${activeColor}`;
        setTimeout(() => {
          circle.style.boxShadow = 'none';
        }, 1200);
      },
    };
  },
};
