/**
 * traceMode — capture the effective tunables for an Agent 1b run so we
 * can compare runs after the fact without re-deriving anything from logs.
 *
 * See docs/AGENT-1-TUNABLES.md §5 for the schema + intent.
 *
 * Persisted on `Analysis.tunables` (Json column).
 */

import type { AnalysisMode, TriageReport } from '@showboxes/shared-types';
import { MODE_BUDGETS } from './render-prompt';

/** Static prompt-side caps that always apply, regardless of mode. */
const STATIC_LARGE_REPO_CUTOFF = 500;
const STATIC_MAX_EXECUTE_TOKENS = 32_000;

export interface ModeTrace {
  mode: AnalysisMode | null;
  /** Files-per-subsystem (focused-brief), total file cap (overview/scorecard/walkthrough), or null. */
  filesPerSubsystem: number | null;
  totalFileCap: number | null;
  /** focused-brief only: 'brief' | 'bullets' | 'detailed'. */
  proseBand: 'brief' | 'bullets' | 'detailed' | null;
  /** Effective depth value the mode ran with (0–1). Unified across modes
   * so cross-mode comparisons are meaningful; see MODE_BUDGETS. */
  depth: number | null;
  /** Cumulative effective budget. Numeric for every mode post-CS-12. */
  effectiveBudget: number | 'unbounded';
  /** focused-brief only: names dropped because we exceeded MAX_FOCUSED_SUBSYSTEMS. */
  clampedSubsystems: string[];
}

export interface TriageTrace {
  totalFiles: number;
  subsystems: { name: string; importance?: number }[];
  entryPoints: string[];
}

export interface TunablesTrace {
  capturedAt: string;
  triage: TriageTrace | null;
  mode: ModeTrace;
  staticCaps: {
    largeRepoCutoff: number;
    maxExecuteTokens: number;
  };
}

/**
 * Build a TunablesTrace from the triage report (if any) and the mode the
 * user picked. Mirrors the logic in `renderModeDirective` — keep these in
 * lockstep when budgets change.
 */
export function traceMode(args: {
  report?: TriageReport | null;
  mode?: AnalysisMode | null;
  /** Names dropped by the focused-brief clamp, if any. */
  clampedSubsystems?: string[];
}): TunablesTrace {
  const { report, mode, clampedSubsystems = [] } = args;

  const triage: TriageTrace | null = report
    ? {
        totalFiles: report.totalFiles,
        subsystems: report.subsystems.map((s) => ({
          name: s.name,
          importance: s.importance,
        })),
        entryPoints: report.entryPoints.map((e) => e.file),
      }
    : null;

  return {
    capturedAt: new Date().toISOString(),
    triage,
    mode: deriveModeTrace(mode ?? null, clampedSubsystems),
    staticCaps: {
      largeRepoCutoff: STATIC_LARGE_REPO_CUTOFF,
      maxExecuteTokens: STATIC_MAX_EXECUTE_TOKENS,
    },
  };
}

function deriveModeTrace(
  mode: AnalysisMode | null,
  clampedSubsystems: string[],
): ModeTrace {
  if (!mode) {
    return {
      mode: null,
      filesPerSubsystem: null,
      totalFileCap: null,
      proseBand: null,
      depth: null,
      effectiveBudget: 'unbounded',
      clampedSubsystems: [],
    };
  }

  switch (mode.kind) {
    case 'overview':
      return {
        mode,
        filesPerSubsystem: null,
        totalFileCap: MODE_BUDGETS.overview.fileBudget,
        proseBand: null,
        depth: MODE_BUDGETS.overview.depthDefault,
        effectiveBudget: MODE_BUDGETS.overview.fileBudget,
        clampedSubsystems: [],
      };

    case 'focused-brief': {
      const filesPerSubsystem = Math.round(15 + mode.depth * 35);
      const proseBand: ModeTrace['proseBand'] =
        mode.depth < 0.34
          ? 'brief'
          : mode.depth < 0.67
            ? 'bullets'
            : 'detailed';
      return {
        mode,
        filesPerSubsystem,
        totalFileCap: null,
        proseBand,
        depth: mode.depth,
        effectiveBudget: filesPerSubsystem * mode.subsystems.length,
        clampedSubsystems,
      };
    }

    case 'scorecard':
      return {
        mode,
        filesPerSubsystem: null,
        totalFileCap: MODE_BUDGETS.scorecard.fileBudget,
        proseBand: null,
        depth: MODE_BUDGETS.scorecard.depthDefault,
        effectiveBudget: MODE_BUDGETS.scorecard.fileBudget,
        clampedSubsystems: [],
      };

    case 'walkthrough':
      return {
        mode,
        filesPerSubsystem: null,
        totalFileCap: MODE_BUDGETS.walkthrough.fileBudget,
        proseBand: null,
        depth: MODE_BUDGETS.walkthrough.depthDefault,
        effectiveBudget: MODE_BUDGETS.walkthrough.fileBudget,
        clampedSubsystems: [],
      };
  }
}
