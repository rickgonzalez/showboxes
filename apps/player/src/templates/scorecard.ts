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
  demo: {
    label: 'Scorecard',
    content: {
      title: 'Codebase report card',
      overallGrade: 'C+',
      items: [
        { label: 'Architecture', grade: 'B+', note: 'Clean layering, clear seams.' },
        { label: 'Testing', grade: 'F', note: 'No tests at all.' },
        { label: 'Security', grade: 'C-', note: 'JWTs are not signature-verified.' },
        { label: 'Docs', grade: 'B', note: 'README + inline is solid.' },
        { label: 'Performance', grade: 'A-', note: 'Async, cached, indexed.' },
        { label: 'Dependencies', grade: 'C', note: '2 majors behind latest.' },
      ],
    },
    emphasizeAfter: { target: '1', delayMs: 2400 },
  },

  render(presenter, contentIn): TemplateHandle {
    const c = contentIn as unknown as ScorecardContent;
    const items = c.items ?? [];

    // ── Wrapper ──────────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'sb-scorecard-wrapper';

    // Title
    if (c.title) {
      const titleEl = document.createElement('h2');
      titleEl.className = 'sb-scorecard-title';
      titleEl.textContent = c.title;
      wrapper.appendChild(titleEl);
    }

    // ── Overall grade badge ──────────────────────────────────────
    // Per-instance grade color flows through CSS custom properties so the
    // shared class can stay generic. `--sb-grade-glow` is the same color
    // with reduced alpha (44/0xff ≈ 27%) — used for the soft outer halo.
    const badge = document.createElement('div');
    badge.className = 'sb-scorecard-badge';
    const oc = gradeColor(c.overallGrade);
    badge.style.setProperty('--sb-grade-color', oc);
    badge.style.setProperty('--sb-grade-glow', `${oc}44`);
    badge.textContent = c.overallGrade;
    wrapper.appendChild(badge);

    // Pop in the badge
    requestAnimationFrame(() => badge.classList.add('sb-visible'));

    // ── Item grid ────────────────────────────────────────────────
    const grid = document.createElement('div');
    grid.className =
      items.length <= 4 ? 'sb-scorecard-grid sb-cols-2' : 'sb-scorecard-grid';

    const cardEls: HTMLElement[] = [];
    const timers: number[] = [];

    items.forEach((item, i) => {
      const gc = gradeColor(item.grade);
      const card = document.createElement('div');
      card.className = 'sb-scorecard-card';
      card.style.setProperty('--sb-grade-color', gc);
      // 66/0xff ≈ 40%, matches the prior emphasize glow alpha.
      card.style.setProperty('--sb-grade-glow', `${gc}66`);

      // Grade + label row
      const headerRow = document.createElement('div');
      headerRow.className = 'sb-scorecard-header';

      const gradeEl = document.createElement('span');
      gradeEl.className = 'sb-scorecard-grade';
      gradeEl.textContent = item.grade;

      const labelEl = document.createElement('span');
      labelEl.className = 'sb-scorecard-label';
      labelEl.textContent = item.label;

      headerRow.appendChild(gradeEl);
      headerRow.appendChild(labelEl);
      card.appendChild(headerRow);

      // Note
      const noteEl = document.createElement('div');
      noteEl.className = 'sb-scorecard-note';
      noteEl.textContent = item.note;
      card.appendChild(noteEl);

      cardEls.push(card);
      grid.appendChild(card);

      // Stagger reveal
      timers.push(
        window.setTimeout(() => card.classList.add('sb-visible'), 300 + i * 150),
      );
    });

    wrapper.appendChild(grid);
    presenter.domRoot.appendChild(wrapper);

    // ── Handle ─────────────────────────────────────────────────
    return {
      dismiss() {
        timers.forEach(clearTimeout);
        wrapper.remove();
      },
      emphasize(target: string) {
        const idx = parseInt(target, 10);
        if (Number.isNaN(idx) || !cardEls[idx]) return;
        const card = cardEls[idx];
        card.classList.add('sb-emphasize');
        timers.push(
          window.setTimeout(() => card.classList.remove('sb-emphasize'), 1200),
        );
      },
    };
  },
};
