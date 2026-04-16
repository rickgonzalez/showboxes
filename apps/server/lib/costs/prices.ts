/**
 * Anthropic model prices — the single source of truth for turning token
 * counts into USD.
 *
 * Prices are per million tokens (Anthropic's published unit) and are a
 * point-in-time snapshot. Update this file when pricing changes and
 * redeploy — there is no external source at runtime. See:
 * https://docs.anthropic.com/en/docs/about-claude/pricing
 *
 * `cacheReadPerMTok` is the discounted rate applied to cached input
 * tokens on models that support prompt caching; if a model doesn't
 * support it, set it equal to `inputPerMTok`.
 *
 * A "family" match means any model id that starts with the key is
 * priced against that row — so `claude-sonnet-4-5-20250929` picks up
 * the `claude-sonnet-4-5` row automatically.
 */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens (non-cached). */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
  /** USD per 1,000,000 cache-read input tokens. */
  cacheReadPerMTok: number;
  /** Human-friendly model name for logs. */
  displayName: string;
}

/**
 * Known model families. Most specific prefixes first so lookups don't
 * accidentally match a shorter prefix.
 */
const MODEL_PRICES: Array<[string, ModelPrice]> = [
  [
    'claude-opus-4-6',
    { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, displayName: 'Claude Opus 4.6' },
  ],
  [
    'claude-opus-4-5',
    { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, displayName: 'Claude Opus 4.5' },
  ],
  [
    'claude-sonnet-4-6',
    { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, displayName: 'Claude Sonnet 4.6' },
  ],
  [
    'claude-sonnet-4-5',
    { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, displayName: 'Claude Sonnet 4.5' },
  ],
  [
    'claude-haiku-4-5',
    { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, displayName: 'Claude Haiku 4.5' },
  ],
];

const FALLBACK_PRICE: ModelPrice = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheReadPerMTok: 0.3,
  displayName: 'unknown model (Sonnet pricing assumed)',
};

export function priceForModel(model: string | null | undefined): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  for (const [prefix, price] of MODEL_PRICES) {
    if (model.startsWith(prefix)) return price;
  }
  return FALLBACK_PRICE;
}

/** Raw token counts captured from one Anthropic call or session. */
export interface StageTokens {
  inputTokens: number;
  outputTokens: number;
  /** Cache-hit input tokens, when the API reports them. Default 0. */
  cacheReadInputTokens?: number;
}

/**
 * USD cost of a single stage given its tokens and the model it ran on.
 * Uses six decimal places internally; consumers should round at display.
 */
export function costUsd(tokens: StageTokens, model: string | null | undefined): number {
  const price = priceForModel(model);
  const inCost = (tokens.inputTokens / 1_000_000) * price.inputPerMTok;
  const outCost = (tokens.outputTokens / 1_000_000) * price.outputPerMTok;
  const cacheCost =
    ((tokens.cacheReadInputTokens ?? 0) / 1_000_000) * price.cacheReadPerMTok;
  return round6(inCost + outCost + cacheCost);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
