/**
 * estimateAnalysisCost — pre-flight estimator for Agent 1b, used to size
 * the pre-analysis reservation. Deliberately crude: the first weeks of
 * production data will tune the multipliers. See the plan's §Step 4 +
 * "Watch-outs" on policy-A overruns.
 *
 * Output is USD → credits at 1 credit = $0.01, rounded up, plus a 25%
 * safety buffer. We want to over-reserve; under-reserving means users
 * silently go into the red on overruns.
 */

import type { TriageReport, AnalysisMode } from '@showboxes/shared-types';
import { priceForModel } from './prices';

export interface EstimateResult {
  usd: number;
  credits: number;
  reasoning: string;
}

export interface EstimateParams {
  triageReport: TriageReport | null;
  mode: AnalysisMode;
  /** Model the analysis will run on. Defaults to Sonnet. */
  model?: string;
}

// Mode factor — how much more or less Agent 1b costs relative to a
// baseline single-pass overview. Tuned against early cost telemetry
// from /api/analyze. See lib/agents/render-prompt.ts MODE_BUDGETS.
const MODE_FACTOR: Record<AnalysisMode['kind'], (mode: AnalysisMode) => number> = {
  overview: () => 1.0,
  'focused-brief': (m) => {
    if (m.kind !== 'focused-brief') return 1.0;
    // Depth bumps input tokens roughly linearly: deep read = more file reads.
    // Baseline 1×, full depth ~3× — matches observed costs.
    return 1 + m.depth * 2;
  },
  scorecard: () => 0.8,
  walkthrough: () => 1.2,
};

// Baseline token assumptions. Output is bounded by the gnome's
// maxExecuteTokens (currently 32k, see trace-mode.ts STATIC_MAX_EXECUTE_TOKENS).
const BASELINE_INPUT_TOKENS = 60_000; // ~30 files × 2k tokens each
const BASELINE_OUTPUT_TOKENS = 12_000; // typical Agent 1b completion
const SAFETY_BUFFER = 1.25;

export function estimateAnalysisCost(params: EstimateParams): EstimateResult {
  const { triageReport, mode, model } = params;
  const price = priceForModel(model ?? 'claude-sonnet-4-5');

  // Scale input tokens by the repo's reported file count, capped so a
  // ridiculous triage report doesn't blow up the estimate. If triage
  // didn't run (or ran empty), fall back to baseline.
  const fileCount = triageReport?.totalFiles ?? 30;
  const fileScale = Math.min(Math.max(fileCount / 30, 0.5), 4);

  const modeFactor = MODE_FACTOR[mode.kind](mode);

  const inputTokens = BASELINE_INPUT_TOKENS * fileScale * modeFactor;
  const outputTokens = BASELINE_OUTPUT_TOKENS * modeFactor;

  const rawUsd =
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok;
  const usd = round6(rawUsd * SAFETY_BUFFER);
  const credits = Math.ceil(usd * 100);

  const reasoning = [
    `${Math.round(inputTokens / 1000)}k in + ${Math.round(outputTokens / 1000)}k out`,
    `on ${price.displayName}`,
    `mode ${mode.kind}×${modeFactor.toFixed(2)}`,
    `files ${fileCount}×${fileScale.toFixed(2)}`,
    `+${Math.round((SAFETY_BUFFER - 1) * 100)}% buffer`,
  ].join(' · ');

  return { usd, credits, reasoning };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
