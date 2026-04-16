/**
 * Credits pricing — the single source of truth for how Codesplain bills.
 *
 * Two tables live here:
 *  - `BUNDLES`: what the customer buys. SKU → (credits, cents).
 *  - `BILLING_TABLE`: what the server debits. operation → credits.
 *
 * Prices are intentionally conservative placeholders; real numbers will be
 * tuned from production cost telemetry. See docs/codesplain/CREDITS.md.
 */

export type BundleSku =
  | 'starter_500'
  | 'builder_2500'
  | 'studio_10000'
  | 'team_50000';

export interface Bundle {
  sku: BundleSku;
  name: string;
  credits: number;
  /** Price in USD cents. Stripe's native unit. */
  amountUsdCents: number;
  /** Set on the bundle you want the UI to highlight. */
  featured?: boolean;
}

export const BUNDLES: readonly Bundle[] = [
  { sku: 'starter_500',   name: 'Starter', credits:    500, amountUsdCents:   500 },
  { sku: 'builder_2500',  name: 'Builder', credits:  2_500, amountUsdCents:  2200, featured: true },
  { sku: 'studio_10000',  name: 'Studio',  credits: 10_000, amountUsdCents:  8000 },
  { sku: 'team_50000',    name: 'Team',    credits: 50_000, amountUsdCents: 35000 },
];

export function getBundle(sku: string): Bundle | undefined {
  return BUNDLES.find((b) => b.sku === sku);
}

/** Credits granted to a new account on first sight. One focused-brief's worth. */
export const FREE_TIER_CREDITS = 150;

/**
 * Per-operation debit rates. Keyed by a stable string; routes look these up
 * rather than hard-coding numbers, so pricing can move in one place.
 */
export const BILLING_TABLE = {
  'agent1a.triage':                  5,
  'agent1b.analysis.overview':       35,
  'agent1b.analysis.focusedBrief':   60, // midpoint of the 40–120 range; actual cost may scale w/ depth
  'agent1b.analysis.scorecard':      30,
  'agent1b.analysis.walkthrough':    40,
  'agent2.script':                    8,
  /**
   * Voice is metered per 100 characters of narration, rounded up.
   * Routes should compute: Math.ceil(totalChars / 100) * rate.
   */
  'voice.per100Chars':                1,
} as const;

export type BillingKey = keyof typeof BILLING_TABLE;

export function debitFor(key: BillingKey, scale: number = 1): number {
  return BILLING_TABLE[key] * scale;
}
