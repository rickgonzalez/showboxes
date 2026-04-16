# Auth & Billing — Implementation Plan

This doc is the handoff spec for wiring authentication and credit-based billing into codesplain. The architectural decisions are made; what's below is the build order and the reasoning, so a fresh session can execute it without rediscovering context.

**Scope:** email + magic-link auth, credit-based billing with a single milestone debit, reservation + settle at the Analysis (Agent 1b) boundary. No Script debit for MVP — revisit later.

**Out of scope:** Clerk/SSO/GitHub OAuth, team accounts, subscriptions, refunds UI, Stripe webhook productionization beyond what's stubbed.

---

## Background — what's already built

Read these first; they establish the foundations this plan builds on:

- [`CREDITS.md`](./CREDITS.md) — credit unit, bundle SKUs, ledger shape, stub endpoints
- [`DISTRIBUTION.md`](./DISTRIBUTION.md) — product framing, why per-operation metering matters
- [`HERO-EMBED-PLAN.md`](./HERO-EMBED-PLAN.md) — unrelated but same shape of spec

Already in the code:

- `apps/server/lib/credits/{prices,ledger}.ts` — SKUs, in-memory ledger, `withCreditDebit()` helper, `InsufficientCredits` error
- `apps/server/lib/costs/{prices,rollup,managed-agents-usage}.ts` — per-stage cost capture, USD pricing, rollup math
- `apps/server/app/api/credits/{balance,pricing,checkout,webhook,history}/route.ts` — stub endpoints, Stripe path sketched
- `Analysis.stageCosts Json?` and `Script.usage` now hold `StageCost[]` / `CostRollup` — see `lib/costs/rollup.ts`
- Console logs a `[cost]` line per successful script run

Already decided with Rick:

- **Debit policy:** option 2 — charge at Analysis (Agent 1b) completion. Triage is free. Script generation from an existing Analysis is free (absorb producer cost into the Analysis debit). Rationale: Agent 1b is the expensive stage (~$0.02–$0.10/run), triage is cheap and often a preview users abandon, and the Analysis JSON is the thing that has extractable value the user could copy out.
- **Auth style:** email + magic-link, modeled on kamclient (`kamclient/pages/api/auth/magic-link/verify.ts`, `kamclient/pages/api/auth/[...nextauth].ts`). No hard gating — create account, validate email, session carries credits. Nothing "fort knox," just enough to prevent someone else spending your credits.
- **Identity key:** session → email → `CreditAccount.email`. When Clerk lands later, migrate by email.

---

## Target flow (happy path)

```
1. User hits codesplain.io, enters email.
2. Server emails a magic link; click lands on /auth/verify?token=...
3. Session cookie set. CreditAccount upserted. Free-tier grant applied on first sight.
4. User pastes a GitHub URL, clicks Generate.
5. Client POST /api/triage  → session id, report returned (no debit)
6. Client shows triage modal, user picks mode + depth.
7. Client POST /api/analyze with mode + triageSessionId.
    a. Server estimates analysis cost (file budget × model rate) → credits.
    b. Server RESERVES that amount on the user's account (see Reservations below).
       If insufficient credits → 402, show top-up modal, abort.
    c. Server kicks off Agent 1b session, returns 202.
8. In the background (after()):
    a. Session completes → capture triage + analysis StageCosts → compute actual debit.
    b. SETTLE reservation: if actual < reserved, release the difference; if > (rare),
       debit the extra.
    c. Write Analysis.stageCosts, Analysis.debitedCredits, Analysis.status=ready.
    d. If session errored: RELEASE reservation in full. No debit.
9. Client polls /api/analyze/[id], sees ready, pulls data.
10. Client POST /api/script — no debit, producer rolls up into Script.usage anyway
    (for internal cost tracking; user is not charged).
```

---

## Implementation steps

The order matters. Don't skip ahead. Each step is independently commitable.

### Step 1 — Prisma schema changes

All additive, nullable. Apply with `npm run -w @showboxes/server db:push`.

```prisma
// New: the account owner of a credit balance. Email-keyed for MVP; a
// `userId` column can be added alongside when real auth lands.
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  emailVerified DateTime?
  // Stripe customer id — created on first checkout, reused thereafter.
  stripeCustomerId String? @unique
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  ledgerEntries LedgerEntry[]
  reservations  CreditReservation[]
  purchases     Purchase[]
  sessions      UserSession[]
  magicLinks    MagicLink[]
  // Materialized cache; always recomputable from ledger entries.
  balance       Int      @default(0)
}

// Append-only ledger. Positive = credit in (purchase, grant, refund).
// Negative = debit out (usage, adjustment). Never update, never delete.
model LedgerEntry {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  amount    Int      // signed
  kind      String   // 'purchase' | 'grant' | 'usage' | 'refund' | 'adjustment' | 'reservation_settle'
  refType   String   // 'purchase' | 'grant' | 'analysis' | 'adjustment' | 'reservation'
  refId     String?
  memo      String?
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
  @@index([refType, refId])
}

// Reservations — held credits that are neither spent nor spendable.
// Created before Agent 1b runs; settled or released when it completes.
// A reservation does NOT write a LedgerEntry on create; it writes one
// when it settles (signed debit) or is released (no entry, just deletes).
model CreditReservation {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  amount      Int      // always positive — the held amount
  refType     String   // 'analysis' for v1
  refId       String   // e.g. Analysis.id
  status      String   // 'held' | 'settled' | 'released' | 'expired'
  // When we settled this reservation, the actual amount debited
  // (may be less than `amount` if the job cost less than estimated).
  settledAmount Int?
  expiresAt   DateTime // safety net — auto-release holds older than N hours
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, status])
  @@index([refType, refId])
}

// Stripe purchase attempts. Already sketched in CREDITS.md.
model Purchase {
  id                    String   @id @default(cuid())
  userId                String
  user                  User     @relation(fields: [userId], references: [id])
  sku                   String
  credits               Int
  amountUsdCents        Int
  stripePaymentIntentId String   @unique
  status                String   // 'pending' | 'succeeded' | 'failed' | 'refunded'
  creditLedgerEntryId   String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([userId])
}

// Magic link tokens. Opaque, single-use, short-lived.
model MagicLink {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  tokenHash String   @unique // sha256 of the token, never store raw
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  @@index([userId])
}

// Server-side sessions. Cookie carries the id; everything else is here.
model UserSession {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  createdAt DateTime @default(now())
  lastSeenAt DateTime @default(now())

  @@index([userId])
}

// Add to existing Analysis model:
//   userId         String?  // the User who started this run
//   reservationId  String?  // CreditReservation.id held for this run
//   debitedCredits Int?     // actual amount debited on settle
```

Also add `@@index([userId])` to Analysis once the column exists.

### Step 2 — Magic-link auth

Structure mirrors `kamclient/pages/api/auth/magic-link/verify.ts`. Three routes, one middleware.

**`/api/auth/request`** (POST)
- Body: `{ email }`. Lower-case + trim.
- Upsert User row. If first sight, write a free-tier LedgerEntry.
- Create MagicLink: random 32-byte token, hash with sha256, store hash + 15-minute expiry.
- Send email via provider (Resend recommended — simple API, good deliverability). Template: a single link to `${APP_URL}/auth/verify?token=${rawToken}`.
- Response: `{ sent: true }`. Never reveal whether the email existed — always say "check your email."

**`/api/auth/verify`** (GET, user lands here from email)
- Query: `?token=…`.
- Hash the token, look up MagicLink. If not found or expired or already used → redirect to `/login?error=invalid`.
- Mark MagicLink used, mark User.emailVerified, create UserSession (30-day expiry), set HTTP-only cookie `cs_session=${sessionId}`.
- Redirect to `/` (or `?next=…` param if we add one later).

**`/api/auth/logout`** (POST)
- Delete the UserSession row, clear the cookie, 204.

**`/api/auth/me`** (GET)
- Read session cookie, return `{ email, balance, createdAt }` or 401. This is what the client polls after login to populate UI.

**`lib/auth/session.ts`** — the function used by every protected route:

```ts
export async function requireUser(req: Request): Promise<User> {
  const cookie = parseCookie(req.headers.get('cookie'))['cs_session'];
  if (!cookie) throw new AuthError('no session');
  const session = await prisma.userSession.findUnique({
    where: { id: cookie },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) throw new AuthError('expired');
  // Touch lastSeenAt async; don't block on it.
  void prisma.userSession.update({ where: { id: cookie }, data: { lastSeenAt: new Date() } });
  return session.user;
}
```

**Cookie flags:** `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, `Max-Age=30d`.

**Email provider:** Resend. One env var (`RESEND_API_KEY`), one domain verification, one template. If Resend isn't desired, Postmark or SendGrid work identically — the code only needs `sendMagicLinkEmail(email, url)`.

### Step 3 — Ledger and reservation helpers

Replace `lib/credits/ledger.ts`'s in-memory fallback with real Prisma calls. Keep the public API identical (`getBalance`, `credit`, `withCreditDebit`, `InsufficientCredits`). Add:

```ts
export async function reserveCredits(params: {
  userId: string;
  amount: number;
  refType: string;
  refId: string;
  ttlMinutes?: number;
}): Promise<{ reservationId: string }>;

export async function settleReservation(
  reservationId: string,
  actualAmount: number, // credits to actually debit
  memo?: string,
): Promise<void>;

export async function releaseReservation(
  reservationId: string,
  reason?: string,
): Promise<void>;
```

Semantics:

- `reserveCredits` checks `balance - (sum of held reservations) >= amount`. If not, throw `InsufficientCredits`. Creates a `CreditReservation` with status `held`. Does NOT write a LedgerEntry.
- `settleReservation` writes a negative LedgerEntry of `-actualAmount`, sets `status: settled`, `settledAmount: actualAmount`. Decrements User.balance by `actualAmount`. Must be idempotent on `reservationId`.
- `releaseReservation` sets `status: released`. Writes no LedgerEntry. Must be idempotent.
- **Balance display rule:** the user-visible balance is `User.balance - sum(reservations where status='held')`. Expose this as `availableBalance` from `/api/auth/me` and `/api/credits/balance`.

**Reservation reaper:** a cron or `after()` that runs every N minutes and releases reservations with `expiresAt < now()`. Safety net only; the happy path releases/settles explicitly.

### Step 4 — Reservation estimate function

One function, one file. This is the "pre-charge" of option 2's reservation.

```ts
// lib/costs/estimate.ts
export function estimateAnalysisCost(params: {
  triageReport: TriageReport | null;
  mode: AnalysisMode;
}): { usd: number; credits: number; reasoning: string };
```

Heuristic for MVP:
- Start with a model-rate floor: `price(sonnet).input * (10 + subsystemFileCount * avgFileKb / 4)` kind of math. Look at `lib/costs/prices.ts` for the rates.
- Multiply by mode factor: overview 1.0×, focused-brief `1 + depth*2`×, scorecard 0.8×, walkthrough 1.2×.
- Multiply by output budget (gnome's `maxExecuteTokens`).
- Add a 25% buffer (we want to over-reserve rather than under-reserve).
- Convert USD → credits: `Math.ceil(usd * 100)`, where 1 credit = $0.01.
- Return all three numbers so the UI can explain the charge.

**Tune in production.** The first 10 runs will teach you what the real factor is. Store estimate vs actual in Analysis row so there's data to tune on.

### Step 5 — Wire reservation into `/api/analyze`

Two changes to `apps/server/app/api/analyze/route.ts`:

**Before** the session kickoff:
1. `const user = await requireUser(req)`.
2. `const estimate = estimateAnalysisCost({ triageReport, mode })`.
3. `const { reservationId } = await reserveCredits({ userId: user.id, amount: estimate.credits, refType: 'analysis', refId: record.id, ttlMinutes: 15 })`.
   - If throws `InsufficientCredits`, return 402 with `{ error: 'INSUFFICIENT_CREDITS', needed: estimate.credits, have: balance, estimate }`.
4. Persist `userId` and `reservationId` on the Analysis row in the initial create.

**At completion** in the `after()` block, after stageCosts are written:
1. Compute actual debit from `stageCosts`: `Math.ceil(sum(stageCosts.costUsd) * 100)`.
2. `await settleReservation(reservationId, actualCredits, memo: 'analysis:' + record.id)`.
3. Write `debitedCredits: actualCredits` to the Analysis row.

**On error**:
1. `await releaseReservation(reservationId, reason: e.message)`.
2. Persist `status: 'error'` as before.

All reservation ops must swallow their own errors loudly (log, don't crash the analysis update). A stuck reservation beats a stuck analysis.

### Step 6 — `/api/triage` requires auth but doesn't charge

One line: `const user = await requireUser(req)`. Used for rate-limiting later (not MVP). No debit, no reservation.

### Step 7 — `/api/script` requires auth but doesn't charge

Same — `requireUser` at the top. Script generation from an existing Analysis is free under our current policy. Still log the `[cost]` line so we can see what it's actually costing us internally.

### Step 8 — Credits + Stripe real wiring

Reuse the stub endpoints in `apps/server/app/api/credits/`. Replace the in-memory fallback by calling the new Prisma-backed ledger. Finish the Stripe paths that CREDITS.md and the stubs already sketched:

- `/api/credits/checkout` — `requireUser`, create/reuse Stripe customer, create PaymentIntent, persist `Purchase` row in `pending` status, return `clientSecret`.
- `/api/credits/webhook` — verify Stripe signature, on `payment_intent.succeeded` flip the Purchase to `succeeded`, write a positive LedgerEntry, increment `User.balance`. Idempotent on event id.
- `/api/credits/balance` — already there; replace email query param with `requireUser`. Return `{ balance, availableBalance, recentEntries }`.
- `/api/credits/history` — same. Paginate once there are enough entries to need it.

### Step 9 — Minimal login UI

A `/login` page with:
- An email input + "Send magic link" button.
- After submit, show "Check your email."
- `/auth/verify` handler already redirects here on success.

A navbar change: replace "Open the player →" with:
- If signed out → "Sign in" link to `/login`.
- If signed in → avatar/initial + balance chip. Clicking opens a dropdown with "Top up," "History," "Sign out."

Tiny React components, both behind `'use client'`.

### Step 10 — Pre-analysis estimate in the triage modal

When the triage modal opens and the user has picked a mode, fetch `POST /api/analyze/estimate` (new route: same body as `/analyze` but returns only the `estimate` object, no side effects). Show `"This analysis will cost ~42 credits ($0.42). You have 158."` as a confirm step. This is the one UI affordance that makes the reservation feel fair. Without it, users hit 402 at a confusing moment.

---

## Rollout order for other sessions

Each of these is a natural-sized PR. Run them in sequence; don't parallelize — each depends on the previous.

1. **Prisma schema + Ledger refactor.** No behavior change yet, but the DB and the `withCreditDebit` signature become real. Smoke test: old `/api/credits/webhook` dev stub still grants credits; `/api/credits/balance` still reads them.
2. **Magic-link auth (no gating).** All routes still public, but `/auth/request`, `/auth/verify`, `/auth/logout`, `/auth/me` work end-to-end with Resend. Smoke test: log in, see session cookie, hit `/api/auth/me`, see email + balance.
3. **Reservation helpers + `estimateAnalysisCost`.** Unit test only — no route integration yet.
4. **`/api/analyze` reserve + settle.** This is the big one. Add `requireUser`. Wire reserve before session start, settle/release in `after()`. Include thorough error handling — orphan reservations are the #1 risk. Smoke test: run analysis with low balance → 402; run with enough → balance drops by the actual amount after completion.
5. **`/api/triage`, `/api/script` auth gates.** Cheap change, lands after 4 so there's something to test the session with.
6. **Credits/Stripe productionization.** Flip the checkout + webhook from stub to real once you have a Stripe account configured. Can land before or after 4.
7. **Login UI + navbar balance chip.** Finalize the user-visible experience.
8. **Estimate preview in triage modal.** Last, once all the plumbing above is solid.

---

## Watch-outs for whoever builds this

- **Balance race:** two analyses started within the same second could both pass the `balance >= amount` check before either reservation lands. Mitigation: wrap the reservation check + write in a single Prisma transaction with `SELECT … FOR UPDATE` on the User row.
- **Orphan reservations** from crashed processes or dropped `after()` calls are the most painful class of bug. The reaper cron (step 3) must be live before step 4 ships to production.
- **Double-settle.** A reservation that settles twice double-charges the user. Make `settleReservation` guard on `status='held'` and short-circuit on `settled|released`. Same for `releaseReservation`.
- **Cache-read tokens in stage costs.** The current `lib/costs/prices.ts` prices them at the cache-read rate. Anthropic bills them correctly; don't "fix" this to charge input rate — you'd over-charge users.
- **Free-tier grant idempotency.** Don't grant twice if the same email logs in via two magic links before the first is used. Check for an existing `grant:free_tier` LedgerEntry on the user before granting.
- **Email deliverability.** Magic-link emails landing in spam is a retention killer. Use a verified sending domain from day one, warm it with a small volume first.
- **Reservation amount vs final amount.** If actual cost is higher than reserved, `settleReservation` has to decide: (a) debit the extra even though not reserved (user goes slightly into the red but got service) or (b) cap at reserved, absorb the overage. Pick (a), log loudly when it happens, tune the estimate. Don't build (b) — it hides the signal.
- **Script generation is currently free.** This is intentional for MVP per the policy call, but it's also the cheap stage. If script-only re-rendering becomes a big cost center, revisit: adding `withCreditDebit` at `/api/script` completion is a 10-line change, everything else is already there.

---

## Open questions (flag for Rick)

1. **Free-tier amount.** CREDITS.md suggests 150. That's ~1 medium analysis. Enough to let someone try the product? Too generous? Worth A/B later; 150 is fine to start.
2. **Magic-link expiry.** 15 minutes is standard; some users find it too short. 30 is also defensible.
3. **Email provider.** Recommending Resend because it's the lowest-friction; Postmark/SendGrid work the same. Decide based on whatever's already in your infra.
4. **Estimate accuracy gate.** Do we want to refuse to run if `estimate > balance * 2`? That would prevent an obvious "you can't afford this" case before reserving. Nice-to-have, not MVP.
