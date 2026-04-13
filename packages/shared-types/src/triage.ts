/**
 * TriageReport — Agent 1a output. A fast, cheap scouting pass that reads
 * the repo tree + manifest files and produces enough signal for the user
 * to decide how to focus the deep analysis (Agent 1b).
 *
 * Design goals:
 *  - Small output (~1-2k tokens). Cheap to run and re-run.
 *  - Derived from tree + manifests + top READMEs. No deep file reads.
 *  - Not persisted (for now) — lives only in the analysis flow session.
 *
 * Mirrors TRIAGE_REPORT_SCHEMA on the server side.
 */

export interface TriageSubsystem {
  /** Short, human-readable name (e.g. "Authentication", "Payments API"). */
  name: string;
  /** Directory path(s) this subsystem lives under. */
  paths: string[];
  /** One-sentence guess at what this subsystem does. */
  purpose: string;
  /** Rough size signal: files or LOC tally. */
  fileCount?: number;
  /** How central this looks to the app (0-1). Drives default selection. */
  importance?: number;
}

export interface TriageEntryPoint {
  file: string;
  role: string;
}

export interface TriageReport {
  repoUrl: string;
  /** Total source files (excluding node_modules, .git, vendored assets). */
  totalFiles: number;
  /** LOC estimate across source files. */
  approxLines: number;
  /** Language breakdown by rough share (sums to ~1). */
  languages: { name: string; share: number }[];
  /** Primary framework/runtime if obvious. */
  framework?: string;
  buildTool?: string;
  /** Monorepo? workspace roots? */
  workspaces?: string[];
  entryPoints: TriageEntryPoint[];
  /** The candidate focus areas the user can pick from. */
  subsystems: TriageSubsystem[];
  /** Headline observations — things worth calling out up front. */
  highlights?: string[];
  /** If triage hit a wall (repo too large, auth failure, etc.) — explain. */
  notes?: string;
}

/**
 * The four presentation modes the user can pick after triage.
 * Each one shapes what the deep-analysis agent (Agent 1b) focuses on
 * and how much it produces.
 */
export type AnalysisMode =
  | { kind: 'overview' }
  | { kind: 'deep-dive'; subsystems: string[] }
  | { kind: 'scorecard' }
  | { kind: 'walkthrough'; entryPoint: string };

export interface TriageRecord {
  id: string;
  repoUrl: string;
  status: 'running' | 'ready' | 'error';
  data: TriageReport | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
