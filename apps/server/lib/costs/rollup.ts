/**
 * Cost rollup for a single script.
 *
 * A script's true cost is the sum of three Anthropic stages:
 *   - Agent 1a (triage)   — Managed Agents, Haiku
 *   - Agent 1b (analysis) — Managed Agents, Sonnet
 *   - Agent 2  (producer) — Messages API, Sonnet/Haiku (configurable)
 *
 * A Script can inherit triage+analysis from a prior Analysis row
 * (re-renders), so we carry forward the recorded stage costs rather
 * than recomputing. Agent 2 cost is always fresh per Script.
 *
 * The rollup is what gets persisted on `Script.usage` (JSON column) and
 * surfaced via `GET /api/scripts/[id]/cost`. Consumers should treat it
 * as an append-only snapshot — if prices change later, historical
 * rollups keep the USD they were written with.
 */

import { costUsd, priceForModel, type StageTokens } from './prices';

export type StageName = 'triage' | 'analysis' | 'producer';

export interface StageCost {
  stage: StageName;
  model: string | null;
  tokens: StageTokens;
  /** USD, computed from tokens × model price at capture time. */
  costUsd: number;
  /** ISO string for when this stage was captured. */
  capturedAt: string;
}

export interface CostRollup {
  /** Version of the rollup shape; bump on breaking changes. */
  version: 1;
  stages: StageCost[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    costUsd: number;
  };
  computedAt: string;
}

/**
 * Build a StageCost from raw token counts. Separating this from the
 * rollup builder lets route handlers call it at the natural moment
 * each stage completes, then stash the resulting object.
 */
export function buildStageCost(
  stage: StageName,
  model: string | null | undefined,
  tokens: StageTokens,
): StageCost {
  return {
    stage,
    model: model ?? null,
    tokens: {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheReadInputTokens: tokens.cacheReadInputTokens ?? 0,
    },
    costUsd: costUsd(tokens, model),
    capturedAt: new Date().toISOString(),
  };
}

/** Sum token counts and USD across stages. */
export function rollupCosts(stages: StageCost[]): CostRollup {
  const totals = stages.reduce(
    (acc, s) => {
      acc.inputTokens += s.tokens.inputTokens;
      acc.outputTokens += s.tokens.outputTokens;
      acc.cacheReadInputTokens += s.tokens.cacheReadInputTokens ?? 0;
      acc.costUsd += s.costUsd;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 },
  );
  // Round the final USD total to six decimal places so summed floats
  // don't leave long tails in the DB.
  totals.costUsd = Math.round(totals.costUsd * 1_000_000) / 1_000_000;

  return {
    version: 1,
    stages,
    totals,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Pretty one-line summary for console logs. Example:
 *
 *   [cost] script abc123  triage 0.0004 + analysis 0.0182 + producer 0.0061 = $0.0247
 */
export function formatRollupLine(rollup: CostRollup, scriptId?: string): string {
  const id = scriptId ? ` ${scriptId}` : '';
  const parts = rollup.stages
    .map((s) => `${s.stage} $${s.costUsd.toFixed(4)}`)
    .join(' + ');
  const total = `$${rollup.totals.costUsd.toFixed(4)}`;
  const modelNames = Array.from(
    new Set(
      rollup.stages
        .map((s) => (s.model ? priceForModel(s.model).displayName : null))
        .filter(Boolean) as string[],
    ),
  ).join(', ');
  return `[cost] script${id}  ${parts} = ${total}  (${modelNames})`;
}
