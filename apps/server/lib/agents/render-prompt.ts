import Handlebars from 'handlebars';
import type { AnalysisMode, TriageReport } from '@showboxes/shared-types';
import type { AnalysisPromptContext } from './code-analysis.gnome';

/**
 * Per-mode defaults for Agent 1b. One table so the prompt text, the
 * trace layer, and any future UI share the same numbers. See
 * docs/AGENT-1-TUNABLES.md §4 (CS-12) for why every mode carries both.
 */
export const MODE_BUDGETS = {
  overview: { fileBudget: 30, depthDefault: 0.3 },
  'focused-brief': { fileBudget: null, depthDefault: 0.3 },
  scorecard: { fileBudget: 60, depthDefault: 0.4 },
  walkthrough: { fileBudget: 40, depthDefault: 0.5 },
} as const;

/** Above this, `focused-brief` stops being focused. */
export const MAX_FOCUSED_SUBSYSTEMS = 5;

export interface RenderResult {
  prompt: string;
  /** The mode as actually applied (after clamping). Null if no mode was set. */
  effectiveMode: AnalysisMode | null;
  /** Subsystem names dropped by the focused-brief cap, in importance order. */
  clampedSubsystems: string[];
}

/**
 * Render the code-analysis gnome's system prompt against a per-run context.
 * Returns the rendered string plus the mode as actually applied, since
 * focused-brief may clamp `subsystems[]` to the top MAX_FOCUSED_SUBSYSTEMS
 * by importance from the triage report.
 */
export function renderCodeAnalysisPrompt(
  template: string,
  ctx: AnalysisPromptContext,
): RenderResult {
  const { effectiveMode, clampedSubsystems } = resolveMode(ctx.mode, ctx.triageReport);

  const compiled = Handlebars.compile(template, { noEscape: true });
  const prompt = compiled({
    repoUrl: ctx.repoUrl,
    focusAreas:
      ctx.focusAreas && ctx.focusAreas.length > 0
        ? ctx.focusAreas.join(', ')
        : undefined,
    priorityPaths:
      ctx.priorityPaths && ctx.priorityPaths.length > 0
        ? ctx.priorityPaths.join(', ')
        : undefined,
    modeDirective: effectiveMode ? renderModeDirective(effectiveMode) : undefined,
  });

  return { prompt, effectiveMode, clampedSubsystems };
}

function resolveMode(
  mode: AnalysisMode | undefined,
  report: TriageReport | undefined,
): { effectiveMode: AnalysisMode | null; clampedSubsystems: string[] } {
  if (!mode) return { effectiveMode: null, clampedSubsystems: [] };

  if (mode.kind !== 'focused-brief' || mode.subsystems.length <= MAX_FOCUSED_SUBSYSTEMS) {
    return { effectiveMode: mode, clampedSubsystems: [] };
  }

  // Rank the requested subsystems by importance from the triage report,
  // keep the top MAX, record the rest as clamped. If we have no report
  // (direct API caller skipped it), preserve input order.
  const importance = new Map<string, number>();
  if (report) {
    for (const s of report.subsystems) {
      importance.set(s.name, s.importance ?? 0);
    }
  }
  const ranked = [...mode.subsystems].sort(
    (a, b) => (importance.get(b) ?? 0) - (importance.get(a) ?? 0),
  );
  const kept = ranked.slice(0, MAX_FOCUSED_SUBSYSTEMS);
  const dropped = ranked.slice(MAX_FOCUSED_SUBSYSTEMS);

  return {
    effectiveMode: { ...mode, subsystems: kept },
    clampedSubsystems: dropped,
  };
}

/**
 * Convert a chosen AnalysisMode into a paragraph the agent reads as part
 * of its system prompt. Every mode emits an explicit file budget — see
 * MODE_BUDGETS for the numbers and docs/AGENT-1-TUNABLES.md for the why.
 */
function renderModeDirective(mode: AnalysisMode): string {
  switch (mode.kind) {
    case 'overview':
      return [
        `Produce a HIGH-LEVEL OVERVIEW. Cap your exploration to ~${MODE_BUDGETS.overview.fileBudget} files total:`,
        'top-level entries, each subsystem\'s main file, and the most important',
        'shared utilities. Keep every section concise. Favor breadth over depth.',
        'The reader wants a tour, not a deep inspection.',
      ].join(' ');

    case 'focused-brief': {
      const filesPerSubsystem = Math.round(15 + mode.depth * 35);
      const proseStyle =
        mode.depth < 0.34
          ? 'one concise paragraph of findings per subsystem'
          : mode.depth < 0.67
            ? 'bulleted findings with brief context per bullet'
            : 'detailed findings with code-path citations and cross-references';
      return [
        `FOCUSED BRIEF on: ${mode.subsystems.join(', ')}.`,
        `Read up to ~${filesPerSubsystem} files per subsystem — prefer files`,
        'the subsystem owns over imported shared utilities.',
        `Produce ${proseStyle}.`,
        'Other areas of the codebase: one-line mentions only, just enough to',
        'situate the focus areas in the wider codebase.',
      ].join(' ');
    }

    case 'scorecard':
      return [
        'Produce a SCORECARD-STYLE analysis. Prioritize codeQuality and health',
        'sections: letter grade, patterns, complexity hotspots, tech debt,',
        'security, strengths, top risks, top wins. Keep architecture and',
        `plainEnglish sections short (one paragraph each). Cap your exploration at ~${MODE_BUDGETS.scorecard.fileBudget} files,`,
        'sampling across subsystems for quality signals rather than touring the repo.',
        'The reader wants to know "is this repo any good and what should we fix first?"',
      ].join(' ');

    case 'walkthrough':
      return [
        `GUIDED WALKTHROUGH centered on entry point: ${mode.entryPoint}.`,
        'Trace this entry point end-to-end as one richly detailed user journey',
        'in the plainEnglish.userJourneys section. Architecture section should',
        'emphasize the modules and data flow this entry point touches.',
        `Cap your exploration at ~${MODE_BUDGETS.walkthrough.fileBudget} files — the entry point and its direct collaborators`,
        'along the traced path. Keep unrelated areas brief.',
      ].join(' ');
  }
}
