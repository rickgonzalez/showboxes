/**
 * AnalysisJSON — the contract between the Code Analysis Gnome (Agent 1)
 * and everything downstream: the Producer Gnome (Agent 2), the web UI,
 * and any future export pipelines.
 *
 * This mirrors the `CODE_ANALYSIS_SCHEMA` JSON Schema declared by the
 * `submit_code_analysis` custom tool. When the gnome calls the tool,
 * the resulting `input.data` is typed exactly like `AnalysisJSON`.
 *
 * If the schema file is updated, update these types in lockstep.
 */

// ── quickFacts ────────────────────────────────────────────────

export interface NotableDependency {
  name: string;
  /** One-sentence description of what this dep does in the project. */
  purpose: string;
}

export interface AnalysisQuickFacts {
  repoUrl: string;
  /** Primary languages, ordered by prevalence. */
  languages: string[];
  /** Primary framework or runtime (e.g. "Next.js 14"). */
  framework: string;
  /** Build tool / bundler (e.g. "Vite"). */
  buildTool?: string;
  totalFiles: number;
  totalLines: number;
  /** Up to ~10 most significant dependencies. */
  notableDependencies?: NotableDependency[];
}

// ── architecture ──────────────────────────────────────────────

export interface EntryPoint {
  file: string;
  role: string;
}

export interface Module {
  /** Human-readable name (e.g. "Authentication"). */
  name: string;
  /** Directory or file path. */
  path: string;
  responsibility: string;
  /** Names of other modules this one depends on. */
  dependsOn: string[];
}

export interface DataFlowStep {
  actor: string;
  action: string;
  file?: string;
}

export interface DataFlow {
  name: string;
  steps: DataFlowStep[];
}

export interface ExternalIntegration {
  name: string;
  purpose: string;
  credentialManagement?: string;
}

export interface AnalysisArchitecture {
  /** 2-3 sentence architectural summary. */
  summary: string;
  entryPoints: EntryPoint[];
  modules: Module[];
  /** Key data flows — 2-4 most important user journeys or data paths. */
  dataFlow: DataFlow[];
  /** Optional ASCII / Mermaid / similar diagram. */
  diagram?: string;
  externalIntegrations?: ExternalIntegration[];
}

// ── codeQuality ───────────────────────────────────────────────

export type OverallGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type PatternGrade = 'good' | 'mixed' | 'poor';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type SecuritySeverity = 'info' | 'warning' | 'critical';
export type Impact = 'low' | 'medium' | 'high';

export interface PatternAssessment {
  /** e.g. "Error handling", "Naming", "Testing". */
  name: string;
  assessment: string;
  grade?: PatternGrade;
}

export interface ComplexityHotspot {
  file: string;
  /** e.g. "45-120" */
  lineRange?: string;
  issue: string;
  severity: Severity;
  suggestion?: string;
}

export interface TechDebtItem {
  description: string;
  file?: string;
  impact: Impact;
}

export interface SecurityConcern {
  description: string;
  file?: string;
  severity: SecuritySeverity;
  remediation?: string;
}

export interface Strength {
  description: string;
  file?: string;
}

export interface AnalysisCodeQuality {
  overallGrade: OverallGrade;
  patterns: PatternAssessment[];
  complexityHotspots: ComplexityHotspot[];
  techDebt: TechDebtItem[];
  securityConcerns?: SecurityConcern[];
  /** Always include at least one — there is always something. */
  strengths: Strength[];
}

// ── plainEnglish ──────────────────────────────────────────────

export interface UserJourney {
  name: string;
  narrative: string;
}

export interface Analogy {
  concept: string;
  analogy: string;
}

export interface AnalysisPlainEnglish {
  /** One sentence a non-developer could understand. */
  oneLiner: string;
  /** 3-5 paragraph plain-English explanation. */
  fullExplanation: string;
  userJourneys: UserJourney[];
  analogies?: Analogy[];
}

// ── health ────────────────────────────────────────────────────

export interface Risk {
  risk: string;
  consequence: string;
}

export interface Win {
  improvement: string;
  impact: string;
  effort?: Impact;
}

export interface ReadingStep {
  file: string;
  why: string;
}

export interface AnalysisHealth {
  /** Honest one-paragraph verdict. */
  verdict: string;
  topRisks: Risk[];
  topWins: Win[];
  /** Ideal reading order — 5-10 files. */
  readingOrder: ReadingStep[];
}

// ── root ──────────────────────────────────────────────────────

export interface AnalysisJSON {
  quickFacts: AnalysisQuickFacts;
  architecture: AnalysisArchitecture;
  codeQuality: AnalysisCodeQuality;
  plainEnglish: AnalysisPlainEnglish;
  health: AnalysisHealth;
}

/**
 * Server-side record wrapping the analysis with metadata. The player
 * receives this from /api/analyze/:id so it can show status, cache by
 * repo URL, and know when the analysis is ready.
 */
export type AnalysisStatus =
  | 'running'
  | 'ready'
  | 'error'
  | 'cancelling'
  | 'cancelled';

export interface AnalysisRecord {
  id: string;
  repoUrl: string;
  commitSha: string | null;
  status: AnalysisStatus;
  agentVersion: string | null;
  data: AnalysisJSON | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight list entry for the repo-version dropdown. Omits `data`
 * and `error` to keep the list payload small; fetch the full record
 * via /api/analyze/:id when the user picks one.
 */
export interface AnalysisSummary {
  id: string;
  repoUrl: string;
  status: AnalysisStatus;
  agentVersion: string | null;
  commitSha: string | null;
  createdAt: string;
  updatedAt: string;
}
