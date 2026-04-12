import type { Template, TemplateHandle } from './registry';

/**
 * scorecard — a report-card grid of metrics with letter grades, color-
 * coded from green (A) through red (F). An overall grade displays large
 * at the top. Individual items show label, grade, and a one-line note.
 *
 * Rendering approach: full DOM. The overall grade is a large centered
 * badge. Below it, items lay out in a 2-column CSS grid of cards.
 * Cards stagger in. Grade colors are computed from a fixed A→F palette.
 *
 * Slot schema:
 *   title?:        string
 *   overallGrade:  string                    ("A" through "F", optionally with +/-)
 *   items:         ScoreItemSpec[]           (3–8 items)
 *
 * emphasize(target): target is the item index as a string ("0", "1", …).
 *   Pulses the card with a glow matching its grade color.
 */

// ── Content contract ────────────────────────────────────────────────

interface ScoreItemSpec {
  /** What is being graded, e.g. "Testing", "Security". */
  label: string;
  /** Letter grade: A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F. */
  grade: string;
  /** One-line note explaining the grade. */
  note: string;
}

interface ScorecardContent {
  title?: string;
  overallGrade: string;
  items: ScoreItemSpec[];
}

// ── Helpers ─────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  'A+': '#22c55e', A: '#22c55e', 'A-': '#4ade80',
  'B+': '#86efac', B: '#a3e635', 'B-': '#bef264',
  'C+': '#facc15', C: '#fbbf24', 'C-': '#f59e0b',
  'D+': '#fb923c', D: '#f97316', 'D-': '#ef4444',
  F: '#dc2626',
};

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade.toUpperCase()] ?? '#94a3b8';
}

// ── Template export ─────────────────────────────────────────────────

export const scorecardTemplate: Template = {
  id: 'scorecard',
  description:
    'Color-coded report card grid with an overall letter grade and individual metric scores.',
  slots: {
    title: 'string — optional headline',
    overallGrade: 'string — overall letter grade (A through F)',
    items: '{ label, grade, note }[] — individual scored metrics (3–8)',
  },

  render(presenter, contentIn): TemplateHandle {
    const c = contentIn as unknown as ScorecardContent;
    const items = c.items ?? [];

    // ── Wrapper ──────────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'scorecard';
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

    // Title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.textContent = c.title;
      Object.assign(titleEl.style, {
        fontSize: '22px',
        fontWeight: '700',
        marginBottom: '16px',
      });
      wrapper.appendChild(titleEl);
    }

    // ── Overall grade badge ──────────────────────────────────────
    const badge = document.createElement('div');
    const oc = gradeColor(c.overallGrade);
    Object.assign(badge.style, {
      width: '96px',
      height: '96px',
      borderRadius: '50%',
      border: `4px solid ${oc}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '48px',
      fontWeight: '800',
      color: oc,
      marginBottom: '28px',
      boxShadow: `0 0 30px ${oc}44`,
      opacity: '0',
      transform: 'scale(0.6)',
      transition: 'opacity 500ms ease, transform 500ms ease',
    });
    badge.textContent = c.overallGrade;
    wrapper.appendChild(badge);

    // Pop in the badge
    requestAnimationFrame(() => {
      badge.style.opacity = '1';
      badge.style.transform = 'scale(1)';
    });

    // ── Item grid ────────────────────────────────────────────────
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: items.length <= 4 ? '1fr 1fr' : '1fr 1fr 1fr',
      gap: '12px',
      width: '100%',
      maxWidth: '680px',
    });

    const cardEls: HTMLElement[] = [];

    items.forEach((item, i) => {
      const gc = gradeColor(item.grade);
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: '#1e293b',
        borderRadius: '10px',
        padding: '14px 16px',
        borderLeft: `4px solid ${gc}`,
        opacity: '0',
        transform: 'translateY(10px)',
        transition: 'opacity 400ms ease, transform 400ms ease, box-shadow 300ms ease',
      });

      // Grade + label row
      const headerRow = document.createElement('div');
      Object.assign(headerRow.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '6px',
      });
      const gradeEl = document.createElement('span');
      gradeEl.textContent = item.grade;
      Object.assign(gradeEl.style, {
        fontSize: '22px',
        fontWeight: '800',
        color: gc,
        lineHeight: '1',
      });
      const labelEl = document.createElement('span');
      labelEl.textContent = item.label;
      Object.assign(labelEl.style, {
        fontSize: '14px',
        fontWeight: '600',
        color: '#e2e8f0',
      });
      headerRow.appendChild(gradeEl);
      headerRow.appendChild(labelEl);
      card.appendChild(headerRow);

      // Note
      const noteEl = document.createElement('div');
      noteEl.textContent = item.note;
      Object.assign(noteEl.style, {
        fontSize: '12px',
        color: '#94a3b8',
        lineHeight: '1.4',
      });
      card.appendChild(noteEl);

      // Store grade color for emphasize
      (card as any).__gradeColor = gc;

      cardEls.push(card);
      grid.appendChild(card);

      // Stagger reveal
      setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, 300 + i * 150);
    });

    wrapper.appendChild(grid);
    presenter.domLayer().appendChild(wrapper);

    // ── Handle ─────────────────────────────────────────────────
    return {
      dismiss() {
        wrapper.remove();
      },
      emphasize(target: string) {
        const idx = parseInt(target, 10);
        if (Number.isNaN(idx) || !cardEls[idx]) return;
        const gc = (cardEls[idx] as any).__gradeColor as string;
        cardEls[idx].style.boxShadow = `0 0 20px ${gc}66`;
        setTimeout(() => {
          cardEls[idx].style.boxShadow = 'none';
        }, 1200);
      },
    };
  },
};
