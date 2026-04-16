# Codesplain Credits — Micro-fee Design

## Purpose

Codesplain runs multi-stage agent pipelines (Haiku triage, Sonnet analysis, a Producer call, and TTS voice generation) that cost us real money per run. We need a metered way to let customers pay for usage without bouncing them to Stripe checkout on every single action.

The pattern is lifted from Kamclient — a game where players buy a pool of "coins" via Stripe and spend them against in-game purchases — and adapted here so that customers buy a pool of **Credits** and spend them against individual codesplain operations (a triage, an analysis, a script, a voice pass).

This is NOT a crypto/token scheme. Credits are an internal accounting unit that corresponds to a specific USD value on our books. They exist purely to make pricing granular and to let us decouple the purchase flow (rare, batched) from the metering flow (frequent, per-operation).

---

## Borrowed from Kamclient

The Kamclient pattern (see `kamclient/pages/api/stripe/create-payment-intent.ts` and `kamclient/pages/api/player/purchase-item.ts`) has three moving parts:

1. **SKU → amount lookup on the server.** The client sends a SKU id, not an amount. `calculateOrderAmount(itemId)` maps ids to cents. Clients can't manipulate price.
2. **Stripe PaymentIntent created server-side, client confirms.** The server returns a `client_secret`; the client uses Stripe Elements to collect card details without the server ever seeing them.
3. **Per-player coin balance stored in a profile document.** Purchases top up the balance; in-game actions debit it.

We preserve (1) and (2) verbatim (they're the right shape). We replace (3) with a proper **double-entry ledger** — see below — because codesplain is going to need audit trails and refunds in a way a game doesn't.

---

## Units

- **1 Credit = $0.01 USD** at list price.
- Credits are integers. No fractional credits. If a metered operation costs less than a cent, we either round up at the operation boundary or accumulate usage and debit in whole credits at session close.
- Bundle SKUs offer volume discounts (the effective rate drops with bigger bundles) but the internal unit is always a whole Credit at $0.01.

Suggested starter SKUs (exact numbers are a pricing decision, not an architectural one):

| SKU id | Display name | Credits | Price (USD) | Eff. rate |
|---|---|---:|---:|---|
| `starter_500` | Starter | 500 | $5.00 | $0.0100 / credit |
| `builder_2500` | Builder | 2,500 | $22.00 | $0.0088 / credit |
| `studio_10000` | Studio | 10,000 | $80.00 | $0.0080 / credit |
| `team_50000` | Team | 50,000 | $350.00 | $0.0070 / credit |

Free tier: every new account gets a one-time grant of `FREE_TIER_CREDITS` (suggested 150 — enough for one focused-brief on a small repo) so the first run never needs a payment step.

---

## Cost model — what each operation debits

These are indicative. Actual numbers will be tuned once we instrument real runs and see our blended Anthropic + TTS costs with a healthy margin. See `BILLING_TABLE` in `apps/server/lib/credits/prices.ts` (to be added).

| Operation | Stage | Cost drivers | Suggested debit |
|---|---|---|---:|
| Triage | Agent 1a (Haiku) | ~30s, ≤4k output tokens | 5 credits |
| Analysis — overview | Agent 1b (Sonnet) | ~30 file reads | 35 credits |
| Analysis — focused-brief | Agent 1b (Sonnet) | 15–50 files × subsystem × depth | 40–120 credits |
| Analysis — scorecard | Agent 1b (Sonnet) | targeted, short | 30 credits |
| Analysis — walkthrough | Agent 1b (Sonnet) | entry-point trace | 40 credits |
| Script generation | Agent 2 (Messages API) | one round-trip, ~4k out | 8 credits |
| Voice pass | ElevenLabs/Kokoro | ~N scenes × clip length | 1 credit per 100 chars of narration |

The debit happens **after** the underlying operation succeeds. If the agent errors, no debit. This keeps the user model simple: "you pay for what you successfully receive."

Re-rendering without re-analyzing (see ARCHITECTURE.md §Resolved Decisions) is important for UX and for billing: tweaking persona/pace only re-runs Agent 2 (8 credits) and optionally Voice, not the expensive analysis.

---

## Data model (Prisma sketch)

The schema lives in `apps/server/prisma/schema.prisma`. Three new models are proposed; they're additive and don't touch existing models:

```prisma
// Owner of a credit balance. For v1 this is keyed by email (pre-Clerk).
// When auth lands we migrate `id` to a Clerk user id and keep email as a
// lookup column.
model CreditAccount {
  id            String   @id @default(cuid())
  email         String   @unique
  stripeCustomerId String? @unique
  // Materialized view of the ledger. Always recomputable by summing
  // LedgerEntry.amount for this account — this column is cache only.
  balance       Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  entries       LedgerEntry[]
  purchases     Purchase[]
}

// Append-only ledger. Credits in = positive amount; debits = negative.
// Never update, never delete — corrections are written as new entries.
model LedgerEntry {
  id         String   @id @default(cuid())
  accountId  String
  account    CreditAccount @relation(fields: [accountId], references: [id])
  // Positive for top-ups and grants, negative for usage debits.
  amount     Int
  // Coarse categorization for reporting.
  kind       String   // 'purchase' | 'grant' | 'usage' | 'refund' | 'adjustment'
  // Free-form reference back to the thing that caused the entry.
  // e.g. `purchase:<Purchase.id>`, `analysis:<Analysis.id>`,
  // `script:<Script.id>`, `grant:free_tier`.
  refType    String
  refId      String?
  // Human-readable note shown in account history.
  memo       String?
  createdAt  DateTime @default(now())

  @@index([accountId, createdAt])
  @@index([refType, refId])
}

// One row per Stripe purchase attempt. Created when we mint a PaymentIntent,
// updated when the webhook confirms or fails.
model Purchase {
  id                 String   @id @default(cuid())
  accountId          String
  account            CreditAccount @relation(fields: [accountId], references: [id])
  sku                String   // 'starter_500', etc.
  credits            Int      // credits to grant on success
  amountUsdCents     Int      // amount charged
  stripePaymentIntentId String @unique
  status             String   // 'pending' | 'succeeded' | 'failed' | 'refunded'
  // When status flips to 'succeeded' we write a corresponding LedgerEntry
  // and store its id here so the two records are traceable.
  creditLedgerEntryId String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([accountId])
}
```

Why double-entry-ish instead of a single `balance` column like Kamclient's `credits: 0`:

- **Auditability.** Every debit has a `refType`/`refId` back to the Analysis, Script, or Purchase that caused it. We can answer "why is this user at 12 credits?" from the DB.
- **Safe refunds.** Refunding a purchase is one new negative entry against the account, not a `balance -= X` race.
- **Recovery.** If the `balance` cache ever diverges, we recompute by summing.

---

## Stripe flow

1. **Client calls `POST /api/credits/checkout`** with `{ sku }`.
2. Server looks up the account (or creates one), ensures a Stripe customer exists (reuses Kamclient's `stripe-customer.ts` pattern), and creates a `PaymentIntent` with the bundle amount in cents.
3. Server writes a `Purchase` row in `pending` status and returns `{ client_secret, purchaseId }`.
4. Client confirms the intent with Stripe Elements.
5. Stripe webhook hits `POST /api/credits/webhook`. On `payment_intent.succeeded`, the server:
   - Marks the `Purchase` row `succeeded`.
   - Writes a `LedgerEntry` with `amount = +credits, kind = 'purchase'`.
   - Increments `CreditAccount.balance`.
   - Stashes the ledger entry id on the purchase.
6. The UI polls `GET /api/credits/balance` (or uses a realtime channel) to show the new balance.

We require webhook confirmation — we don't trust the client's "payment succeeded" for minting credits. This matches Kamclient's model but with an explicit `Purchase` row tracking each attempt.

---

## Metering flow

Every codesplain operation that costs money follows the same pattern:

```ts
await withCreditDebit(
  { account, cost: 40, refType: 'analysis', refId: analysis.id, memo: 'focused-brief' },
  async () => runAgent1b(...)
);
```

`withCreditDebit` does:

1. Pre-check: `balance >= cost`. If not, throw `InsufficientCredits`. The API route maps this to `402 Payment Required` so the UI can surface a "Top up to continue" modal.
2. Run the inner operation.
3. On success, write a negative `LedgerEntry` and decrement `balance`.
4. On error, do nothing (no debit for failed work).

For v1 we do a simple pre-check + post-debit. There's a minor race if a user fires two expensive operations simultaneously — both pre-checks pass, both debits land, balance could go slightly negative. We accept this for now and add a transactional reservation pattern if it becomes a real problem.

---

## Endpoints

All new routes live under `apps/server/app/api/credits/`:

| Route | Method | Purpose |
|---|---|---|
| `/api/credits/balance` | GET | Returns `{ balance, recentEntries[] }` for the current account. |
| `/api/credits/pricing` | GET | Returns the public SKU table. |
| `/api/credits/checkout` | POST | Body: `{ sku }`. Returns `{ clientSecret, purchaseId }`. |
| `/api/credits/webhook` | POST | Stripe webhook target. Verifies signature, updates `Purchase`, writes `LedgerEntry`. |
| `/api/credits/history` | GET | Paginated ledger entries for account history UI. |

Existing routes that should wrap their work in `withCreditDebit`:

- `POST /api/analyze` (triage + analysis — two separate debits, one per stage)
- `POST /api/script` (Agent 2 debit)
- Future `POST /api/voice` (TTS debit, per-scene)

---

## What's stubbed in this first pass

This doc lands alongside code scaffolding intended to be obviously-unfinished:

- `apps/server/app/api/credits/balance/route.ts` — returns a stubbed account.
- `apps/server/app/api/credits/pricing/route.ts` — returns the SKU table from `prices.ts`.
- `apps/server/app/api/credits/checkout/route.ts` — echoes back a fake `client_secret` unless `STRIPE_SECRET_KEY` is set.
- `apps/server/app/api/credits/webhook/route.ts` — signature-verification skeleton, no DB writes.
- `apps/server/lib/credits/prices.ts` — SKU table + `BILLING_TABLE` for per-operation costs.
- `apps/server/lib/credits/ledger.ts` — `withCreditDebit` signature, in-memory fallback so routes that wrap it don't break in dev.

No Prisma migration is shipped with this pass. The schema additions above are a sketch — we'll land them under their own ticket once we agree on field shapes.

---

## Open questions (tracked here, not yet decided)

1. **Who owns the account?** Email-keyed works for pre-auth. Once we add Clerk or GitHub OAuth, do we migrate by email or force sign-in before first purchase?
2. **Refund policy.** If an agent run produces a garbage script, do users get their credits back on a "flag"? Manual for v1, automated later?
3. **Team accounts.** A `CreditAccount` per seat vs. a shared org pool. Probably org pool with per-seat spend caps — but not for v1.
4. **Subscription vs. bundles.** Monthly-recurring credit grants ("Studio plan: 10,000 credits/month") vs. one-shot bundles. Mirror this later as a `Subscription` model; the ledger doesn't change.
5. **Volume discount curve.** Current table is a guess. Revisit once we have blended cost-of-goods numbers from real runs.
