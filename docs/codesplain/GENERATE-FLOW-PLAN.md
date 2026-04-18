# Generate Flow — The Director UI Plan

This doc specifies the single guided flow that replaces the current PipelinePanel's multi-stage UI. The goal: give the user one focused surface that walks them from "paste a repo URL" to "watch the script play," never surfacing the intermediate artifacts (triage session, Analysis row, Script row) as their own screens.

This is the user-visible consequence of the decisions in [EMBED-AND-AUTH-PLAN.md](./EMBED-AND-AUTH-PLAN.md): Analysis is not user-addressable, Script is the shareable unit, viewer-mode embeds are a separate surface entirely.

## The flow

One modal-sized component, six states.

```
┌────────────────────────────────────────────────────────────┐
│  1. URL INPUT                                              │
│     Paste repo URL → [Generate]                            │
└──────────────┬─────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────┐
│  2. TRIAGE RUNNING                                         │
│     Spinner + "Scoping your codebase…"                     │
│     Elapsed timer, mean-time hint ("~30s typical")         │
│     [Cancel] (free — triage is on us)                      │
└──────────────┬─────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────┐
│  3. TRIAGE CHOICES (current TriageModal content)           │
│     Mode picker + subsystem/depth/entry-point inputs       │
│     Live estimate: "~42 credits · you have 158"            │
│     [Back] [Generate]                                       │
└──────────────┬─────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────┐
│  4. ANALYSIS RUNNING (the expensive one)                   │
│     Spinner + "Building the analysis…"                     │
│     Elapsed timer, mean-time hint ("~4min typical")        │
│     Reserved credits chip: "~42 credits held"              │
│     [Cancel] — opens the cancel-confirm modal              │
└──────────────┬─────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────┐
│  5. SCRIPT RUNNING                                         │
│     Spinner + "Composing the script…"                      │
│     Elapsed timer (this stage is free to the user)         │
│     No cancel button — money's already spent               │
└──────────────┬─────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────┐
│  6. PLAYING                                                │
│     Script plays. "Try another angle" button returns to #3.│
│     "Start over" button returns to #1.                     │
└────────────────────────────────────────────────────────────┘
```

### The loop

From state 6 ("Playing"):

- **"Try another angle"** → jump to state 3 with the *same* TriageReport. No re-triage. Cheaper and faster. New Analysis row, new Script row — both scoped to the same TriageReport/session.
- **"Start over"** → jump to state 1. Clears everything.

The TriageReport is kept in component state (and optionally localStorage, keyed by `repoUrl + commitSha`) so reopening the same generator for the same repo warm-starts into state 3.

## Why this replaces what's there

Today, [PipelinePanel.tsx](apps/player/src/pipeline/PipelinePanel.tsx) is a five-tab control surface: repo URL, analysis JSON viewer, script JSON viewer, settings, cached-version dropdowns. It surfaces every intermediate artifact as a tab. That was right for internal tuning; it's wrong for end users, because:

- The Analysis tab shows the Analysis JSON — the user will never need or want this.
- The version dropdowns ("prior analyses for this repo") imply Analysis is a user-facing resource.
- The Settings tab lets the user edit UserSettings mid-flow, which bloats the decision space.
- Triage is surfaced as its own modal over the pipeline panel; the modal returning to the panel with "now pick a mode" before running is the old shape.

The new generate flow collapses all of that into one modal-sized surface. The old PipelinePanel stays available behind a "developer mode" toggle for ongoing prompt/template tuning (us, not users) — that's what the flag/notes button is for, per [project_notes_are_internal.md](../../memory/project_notes_are_internal.md).

## States in detail

### State 1 — URL input

One input, one button. Validate shape client-side (GitHub URL regex). No network calls yet.

If `requireUser` returns 401 (not signed in), the button label reads "Sign in to generate" and clicking routes to `/login?next=/generate`. Signed-in users see "Generate."

### State 2 — Triage running

Optimistic transition — click "Generate" in state 1, immediately show state 2's spinner, fire `POST /api/triage` in the background.

- Show a live elapsed timer ("0:14") and a typical-time hint ("~30s for most repos").
- If triage takes >60s, swap the hint to "taking longer than usual…" — honest, not alarming.
- **Cancel button is live.** Triage is cheap and free to the user; canceling just aborts the fetch and returns to state 1. The server-side triage session may keep running briefly — fine, it's our cost. We call `cancelSessionWithRejection` best-effort to cap it.

On success → store TriageReport in state, advance to state 3.
On error → return to state 1 with an inline error banner ("Couldn't scope that repo — [reason]. Try again?").

### State 3 — Triage choices

This is essentially the existing [TriageModal.tsx](apps/player/src/pipeline/TriageModal.tsx) body, no visual change needed. The differences from today:

- It's now a *state* of the generate flow, not a modal over another UI. Back button returns to state 1 (and discards the TriageReport — user is restarting).
- The estimate preview logic stays the same: it debounces on mode/depth/subsystem changes and fetches `POST /api/analyze/estimate`.
- The availability chip ("you have 158 credits") works correctly once the dev-loop CORS fix from EMBED-AND-AUTH-PLAN §Dev-loop lands.

On "Generate" → advance to state 4 and fire `POST /api/analyze`.

### State 4 — Analysis running

The main event. Spinner, timer, reservation chip, cancel button.

- `POST /api/analyze` returns 202 with `{ id, sessionId, estimate }`. The client starts polling `GET /api/analyze/:id` per the existing `pollAnalysis` helper ([apps/player/src/pipeline/api.ts](apps/player/src/pipeline/api.ts#L129)).
- Show the reserved amount: "~42 credits held during this run." This anchors the cancel modal's copy.
- Show elapsed time and a typical-time hint ("~3–5min for overview, longer for deep-dive"). Pull the hint from the selected mode so it's accurate.
- **Cancel button:** opens the cancel-confirm modal (see §Cancel, below).

On status `ready` → advance to state 5 and fire `POST /api/script`.
On status `error` → return to state 3 (preserve choices), show inline error. Reservation was released server-side per AUTH-AND-BILLING-PLAN §Step 5.
On status `cancelled` → return to state 3 (preserve choices), show toast: "Cancelled. Charged N credits for work completed."

### State 5 — Script running

Short-lived stage. No cancel button — the expensive work is done.

- POST `/api/script` with the ready Analysis. Show "Composing the script…" spinner, elapsed time, no cost chip (free to the user).
- On success → advance to state 6.
- On error → stay in state 5 with retry button ("Try again" calls `/api/script` again; same Analysis, new attempt). The Analysis debit has already settled, so a retry is free. If retry also fails, fall back to state 3 with an error banner.

### State 6 — Playing

Hands off to the player ([apps/player/src/App.tsx](apps/player/src/App.tsx)) in author-mode on the home origin. Two buttons overlaid on the player chrome:

- **"Try another angle"** → back to state 3 with the same TriageReport cached.
- **"Start over"** → back to state 1.

The player renders normally; Script is persisted and has a URL the user can share (`/viewer/:scriptId?token=...` once that route ships per EMBED-AND-AUTH-PLAN §Rollout step 6).

## Cancel (state 4 only)

Locked from the prior conversation. Cancel button is only visible during state 4.

**Modal copy:**

> **Cancel this analysis?**
>
> The work already completed will be billed, but we'll stop any further charges. The amount depends on how far the analysis got — you'll see the final number on your credits page.
>
> [Keep running] [Cancel analysis]

**On confirm:**

1. Client POSTs `/api/analyze/:id/cancel`.
2. Server calls `cancelSessionWithRejection(analysis.sessionId)` (reference implementation at [reference/gnome-kit/services/agent.session.service.ts:1399](reference/gnome-kit/services/agent.session.service.ts#L1399)). Best-effort — log on failure, don't error the user.
3. Server sets `analysis.status = 'cancelling'`.
4. The in-flight `after()` block detects the session ended with rejection, captures whatever StageCosts Anthropic already reported, computes actual debit.
5. `settleReservation(reservationId, actualCredits, memo: 'cancelled:' + id)` debits only what was actually spent; remainder of the reservation is released.
6. `analysis.status = 'cancelled'`.
7. UI (polling) sees `cancelled`, returns to state 3, shows toast.

**Race handling:** if the session completes between the cancel button click and the server's cancel call, `settleReservation` is idempotent (status guard `held` → short-circuits on `settled`). Behavior: the Analysis finishes normally, cancel is a no-op, toast reads "Analysis completed before cancel — here's your Script" and the UI advances to state 5.

**Phase 1 (triage) cancel** is a separate lighter flow — "Cancel? You haven't been charged yet." [Keep scoping] [Cancel] — no server-side cost accounting needed.

**No cancel in states 5/6.**

## Server changes required

Small set. Most of the plumbing exists.

- **New route `POST /api/analyze/:id/cancel`:**
  - `requireUser` + ownership check (`analysis.userId === user.id`).
  - Rejects if `analysis.status !== 'running'`.
  - Calls `cancelSessionWithRejection(analysis.sessionId)`.
  - Sets `analysis.status = 'cancelling'` and returns 202.
- **Update the `after()` block in `/api/analyze`** to handle the cancelled case: detect session ended via rejection, capture partial StageCosts (whatever Anthropic reported), settle with the partial amount, set `status: 'cancelled'`.
- **New Analysis status values:** `running` → `cancelling` → `cancelled` (in addition to existing `running` → `ready`/`error`). Enum-as-string.
- **Typical-time hints:** pull from the gnome's `defaultModel` + mode to compute a rough ETA for the UI. Doesn't need to be precise — "~3–5 min" is fine. Can live client-side from a static table keyed by mode.

## Client changes required

- **New component: `GenerateFlow.tsx`** in `apps/player/src/pipeline/`. State machine for the six states above. Replaces PipelinePanel as the primary UI.
- **Reuse:** TriageModal's body becomes state 3's render. `pollAnalysis` is reused unchanged. Estimate fetch is reused.
- **Gate PipelinePanel behind a developer-mode flag.** It stays; we use it for tuning. Default off for end users.
- **Router:** `/generate` route hosts `GenerateFlow`. Logged-out users get redirected to `/login?next=/generate`.

## States we're NOT supporting

Flagging so whoever builds this doesn't add them back:

- **No "resume in progress" surface.** If the user closes the tab mid-analysis, the `after()` block completes on the server; when they come back, the Script is in their history. We do not build a "1 analysis in progress" banner. The polling, if reopened, picks up where it left off based on the Analysis id — but we don't proactively rehydrate state. This is a simplification; revisit if users complain about lost context.
- **No mid-flow settings editor.** UserSettings (voice, palette, etc) are set in a separate `/settings` page, not during generation.
- **No multi-repo generation queue.** One repo at a time, one flow.
- **No mid-analysis Analysis JSON preview.** Internal artifact, not user-surfaced. Stays behind the dev-mode toggle.

## Rollout order

Two PRs.

1. **Cancel infra.** `POST /api/analyze/:id/cancel`, `after()` handles the cancelled case, new `cancelling`/`cancelled` status values. Tested against the existing PipelinePanel UI with a temporary cancel button wired in — no GenerateFlow yet.
2. **GenerateFlow component + `/generate` route.** New UI. Leave PipelinePanel in place, behind a dev-mode toggle. Ship after cancel is solid.

## Watch-outs

- **Timers must use `useEffect` with a cleanup.** React strict-mode will double-mount in dev and leak intervals otherwise — a bug I've introduced myself multiple times.
- **Don't poll the Analysis endpoint forever.** Existing `pollAnalysis` has a 15-minute ceiling; keep it. If a run genuinely takes longer, we have bigger problems and the UI should show "taking much longer than usual — check your credits page for the final state."
- **State 3 "Back" semantics.** Going back from state 3 to state 1 should *not* abort the triage session (it already completed). But the TriageReport is discarded, so the *next* click of Generate re-runs triage. That's the simpler mental model; avoid clever "remember the triage per URL" behavior that only confuses people.
- **Network failure on state 4 polling.** If `GET /api/analyze/:id` starts 5xx'ing, don't panic-cancel. Retry with backoff; show "lost connection, reconnecting…" The analysis itself is unaffected — it's running in `after()` on the server.
- **Don't leak the sessionId or Analysis.id to the viewer-mode embed.** The generator flow lives only on codesplain.io. Viewer mode only ever sees Scripts by id/shareToken (per EMBED-AND-AUTH-PLAN).
- **Analytics.** Track state transitions as events: `generate:triage_started`, `generate:choices_confirmed`, `generate:analysis_cancelled`, etc. This is the funnel we'll want to debug and optimize later.

## Decided

- **Single guided flow replaces PipelinePanel as the primary UI.** PipelinePanel survives behind a dev-mode toggle for prompt/template tuning. Decided 2026-04-17.
- **No Analysis JSON surface for end users.** Intermediate artifacts are not shown. Decided 2026-04-17 (consistent with EMBED-AND-AUTH-PLAN §Analysis visibility).
- **Cancel only during state 4 (analysis).** State 2 (triage) cancel is a lighter "no charge" flow. No cancel in states 5 (script) or 6 (playing). Decided 2026-04-17.
- **"Try another angle" loop returns to state 3 with cached TriageReport.** No re-triage on re-run. Decided 2026-04-17.

## Open questions

1. **Does the cancel-confirm modal block interaction, or is it dismissible by clicking outside?** Recommend: blocking (click-outside does nothing), because the accidental cancel is worse than an accidental confirm-of-keep-running.
2. **Do we show the reservation release amount in the cancel toast, or just "charged N credits"?** Two numbers ("charged N of ~42 held") is more informative but may feel like arithmetic. One number is cleaner. Lean: one number, cleanly rounded.
3. **Does "Try another angle" preserve the old Script as a history item, or replace it?** Existing UI has a scripts dropdown; the loop could populate it. Recommend: history-preserving, dropdown lives in state 6's player chrome.
4. **What happens to the Script dropdown on mobile/embed?** Probably irrelevant — the generator flow is desktop-only; mobile users go to the viewer, where the dropdown doesn't exist. Worth explicit decision.

---

## Update — 2026-04-17 (first-pass implementation)

Pivoted from the "desktop-only generator" assumption: the flow was built **mobile-first** from the start. Rollout order was collapsed into a single pass instead of the two-PR split in §Rollout — cancel infra and `GenerateFlow` shipped together. The old [PipelinePanel.tsx](apps/player/src/pipeline/PipelinePanel.tsx) is still the default at `/`; `/generate` is additive.

### What landed

- **Path-based router in [apps/player/src/main.tsx](apps/player/src/main.tsx).** No react-router dep. `/generate` → `GenerateFlow`, `/viewer/:id` → `Viewer`, everything else → existing internal `App`.
- **[apps/player/src/pipeline/GenerateFlow.tsx](apps/player/src/pipeline/GenerateFlow.tsx) — the 6-state machine.** Discriminated-union `FlowState`, polling loop in a `useEffect`, cancel-confirm modal, state-6 player inline.
- **Header with logo + balance chip.** Logo copied to [apps/player/public/codesplain_logo.png](apps/player/public/codesplain_logo.png); chip hydrates from `/api/auth/me` on mount. Shows a "Sign in" link (to `/login?next=/generate`) for signed-out users.
- **Mobile-first CSS block appended to [index.css](apps/player/src/index.css)** under the `.sb-generate-*` namespace. iOS-safe input sizing (16px minimum to avoid focus-zoom), `env(safe-area-inset-*)` padding, sticky glassy header, stacked-on-mobile / side-by-side-on-tablet loop buttons, reduced-motion spinner fallback.
- **Cancel infrastructure (server):**
  - New route [apps/server/app/api/analyze/[id]/cancel/route.ts](apps/server/app/api/analyze/%5Bid%5D/cancel/route.ts) — owner-checked, 409 on non-`running`, best-effort interrupts the Managed Agents session.
  - New helper `interruptSession` in [agents/session.ts](apps/server/lib/agents/session.ts) (posts `user.interrupt`). Simpler than the reference `cancelSessionWithRejection` since we don't have the marymary approval loop.
  - `after()` in [analyze/route.ts](apps/server/app/api/analyze/route.ts) now detects `cancelling` and settles against partial `stageCosts` (Policy-A: debit what was actually spent, release the rest). Falls back to release-only when token usage is 0.
  - `cancelling` + `cancelled` added to `AnalysisStatus` in [shared-types/analysis.ts](packages/shared-types/src/analysis.ts).
- **Client API hardened in [pipeline/api.ts](apps/player/src/pipeline/api.ts):**
  - `AnalyzeAuthError` (401) and `InsufficientCreditsError` (402) typed errors so the UI can route to `/login` or show a top-up CTA.
  - `cancelAnalysis(id)`, `fetchMe()`, abort-signal support on `runTriage`, `credentials: 'include'` on every call that touches the session.
  - `pollAnalysis` now exits cleanly on `cancelled` and keeps polling through `cancelling`.

### Deviations from the plan

- **No "typical-time hint from gnome defaults" table.** Hard-coded `~3–5 min typical` on the analysis step. Good enough until we see real variance in production; the hint-per-mode lookup described in §Server changes is a follow-up.
- **State 6 player reuses `StubVoicePlayer` / `WebSpeechVoicePlayer`**, not GoogleCloudVoicePlayer. No `SERVER_URL` plumbing through the flow yet — adding the Google option is a toggle away but wasn't needed for a working path.
- **Estimate preview is deferred to TriageModal, not re-fetched in state 3 with a new API.** The existing `fetchAnalyzeEstimate` already runs inside TriageModal, so the "~42 credits · you have 158" affordance works as soon as the CORS dev-loop fix lands.

### Open items for follow-up PRs

Ordered by how much they block a real user walking through the flow.

1. **`/login` does not exist yet.** Auth redirects push users to `/login?next=/generate`, which 404s. Blocks the signed-out path entirely. Covered by AUTH-AND-BILLING-PLAN step 9 but not yet built. Until then, `GenerateFlow` can only be exercised by a user who already has a session cookie from some other route.
2. **Cross-origin cookie in dev.** The player at `:5173` calls the server at `:3001`; `credentials: 'include'` is set on every fetch, but [next.config.ts](apps/server/next.config.ts) still emits `Access-Control-Allow-Origin: *`, which browsers refuse with credentials. The balance chip reads "Sign in" in dev even when authed on the server origin. Fix is in EMBED-AND-AUTH-PLAN §Dev-loop. Prod (same origin) is unaffected.
3. **No in-browser walkthrough yet.** Code typechecks and vite builds; no one has clicked repo-url → playing end-to-end. First real run will surface small UX bugs (scene advance timing with the minimal inline player, timer tear-down across StrictMode double-mount, cancel latency while `after()` finishes).
4. **Developer-mode toggle for the old PipelinePanel.** Plan says gate it behind a flag so end users on `/` don't see it. Not done — the old panel is still at `/`. Low priority since the new surface lives at `/generate` anyway, but worth doing before pointing a real user at the bare domain.
5. **Script history / "Try another angle" preservation.** Button works (jumps back to state 3 with cached `TriageReport`), but nothing surfaces the *old* Script once the new one plays. Open question #3 is still open; MVP just replaces.
6. **Analytics events.** `generate:*` transitions aren't wired. Easy to add — one `console.log` per `setState` is probably fine for now, swap in a real client when we pick one.
7. **Cancel-modal dismissal (open question #1).** Current impl: backdrop click does nothing (blocking). Matches the recommendation — flagging so it's a conscious choice, not an accident.
8. **Script retry on error.** Plan §State 5 describes a "Try again" button; current impl bounces back to state 3 with an inline error. Worth adding the in-place retry once we see a real failure mode.
9. **Reservation overage warning.** `after()` logs `[credits] overrun` to stderr but nothing surfaces to the user. Fine for MVP (Policy-A silently absorbs), but worth a UI hint when the delta is large.
10. **`cancelling` → watchdog.** If `after()` dies mid-flight, Analyses can sit in `cancelling` forever. The reservation reaper (AUTH-AND-BILLING-PLAN step 3) will release the hold, but the Analysis row stays `cancelling`. Add a second reaper or extend the existing one to flip stale `cancelling` → `cancelled` after N minutes.

---

## Update — 2026-04-17 (end-to-end auth wiring — tested through)

Closed the three loose ends that blocked a real user walking from "not signed in on `:5173/generate`" to "script playing." Tested end-to-end in a fresh incognito window: magic-link login → landed back on `/generate` signed in → balance chip populated → triage → analysis → script → play. Happy path works.

### What shipped

- **Vite proxy in dev** — [apps/player/vite.config.ts](apps/player/vite.config.ts) now proxies `/api`, `/login`, and `/_next` to `http://localhost:3001`. Makes the browser see everything as same-origin on `:5173`, so `cs_session` (`SameSite=Lax`, `HttpOnly`) rides along with every fetch. Prod is unaffected — player is transpiled into Next there (per `transpilePackages` in `apps/server/next.config.ts`), so origins already collapse.
- **`VITE_SERVER_URL=""` in [apps/player/.env.development](apps/player/.env.development)** — was previously `http://localhost:3001`, which made the player call the server directly, skipping the proxy and triggering the `*`+`credentials` CORS error. Empty string makes `pipeline/api.ts` build relative URLs that hit the proxy. This was the subtle gotcha that broke the first walkthrough.
- **`next=` round-trip** via a short-lived `cs_next` cookie (no schema change):
  - New helpers in [apps/server/lib/auth/next.ts](apps/server/lib/auth/next.ts): `safeNextPath` (open-redirect guard: rejects `//`, schemes, non-`/` starts, >512 chars), `buildNextCookie`, `buildClearNextCookie`.
  - [`POST /api/auth/request`](apps/server/app/api/auth/request/route.ts) — accepts optional `next` in the body, validates it, sets `Set-Cookie: cs_next=<path>; HttpOnly; SameSite=Lax; Max-Age=1200`.
  - [LoginForm.tsx](apps/server/app/login/LoginForm.tsx) — reads `?next=` from `window.location.search` and forwards in the request body.
  - [`GET /api/auth/verify`](apps/server/app/api/auth/verify/route.ts) — reads `cs_next` cookie, redirects to `${APP_URL}${nextPath ?? '/'}`, appends a clearing `Set-Cookie: cs_next=; Max-Age=0` alongside the session cookie.
- **Dev env flip:** `APP_URL=http://localhost:5173` in the server's dev `.env`. Magic-link email URLs and the post-verify 302 now land on the player origin where `/generate` actually lives; Vite proxies `/api/auth/verify` to Next so the handler still runs.

No changes to `GenerateFlow.tsx` or `pipeline/api.ts` were needed — the five existing `window.location.assign('/login?next=/generate')` call sites "just work" once `/login` is proxied, and `credentials: 'include'` was already set on every fetch.

### Known loose ends surfaced during testing (for future sessions)

1. **Server-origin login fallback lands on `/generate`.** Resolved in-session by switching the no-`cs_next` fallback in [`/api/auth/verify`](apps/server/app/api/auth/verify/route.ts) from `${appUrl}/` to `${appUrl}/generate`. Rationale: the root of the player (`App.tsx`) is still the old internal exerciser / PipelinePanel, which isn't a useful landing for a freshly-authed user. The generator is. If a user wants the dev exerciser, they navigate to `/` manually.

   Still open in this area (for future UI-cleanup sessions):
   - `/login` on `:3001` has no entry link to `/generate`, so server-origin visitors have no natural path into the generator. Add a CTA on `/` or the login page.
   - Once the PipelinePanel is gated behind a dev-mode flag (follow-up #4), revisit whether `/` should redirect to `/generate` for authed users so the bare domain becomes the generator.

2. **`APP_URL` in dev now points at the player origin.** This was the right call for the auth round-trip, but anything else on the server that uses `APP_URL` (Stripe webhooks, non-auth emails if we add them) will inherit `:5173` in dev. Grep showed only the two auth files use it today — worth rechecking before shipping Stripe productionization (AUTH-AND-BILLING-PLAN step 8).

3. **`cs_next` is origin-bound.** Works great when the user starts and finishes on the same browser. Cross-device magic-link click (desktop request, mobile click) loses the cookie, so the user lands on `/` instead of `/generate`. Fine for MVP; revisit if it shows up in user feedback.

### Verified in incognito

1. Fresh `:5173/generate` → header shows "Sign in," `GET /api/auth/me` 401 with no CORS error.
2. Click "Sign in to generate" → lands on `:5173/login?next=/generate`, Next renders through the proxy.
3. Submit email → `POST /api/auth/request` 200, `Set-Cookie: cs_next=%2Fgenerate` in response headers (verified in DevTools).
4. Click magic link (URL starts with `http://localhost:5173`) → 302 to `http://localhost:5173/generate`, `cs_session` set, `cs_next` cleared.
5. Balance chip populates, TriageModal shows "You have N credits" (not "Sign in to see your balance"), triage → analysis → script → play all work.

### Files touched this session

- [apps/player/vite.config.ts](apps/player/vite.config.ts) — added `server.proxy`.
- [apps/player/.env.development](apps/player/.env.development) — set `VITE_SERVER_URL=""`.
- [apps/server/lib/auth/next.ts](apps/server/lib/auth/next.ts) — **new file**.
- [apps/server/app/api/auth/request/route.ts](apps/server/app/api/auth/request/route.ts) — accept `next`, set `cs_next`.
- [apps/server/app/login/LoginForm.tsx](apps/server/app/login/LoginForm.tsx) — forward `?next=`.
- [apps/server/app/api/auth/verify/route.ts](apps/server/app/api/auth/verify/route.ts) — consume `cs_next`, redirect, clear.
- Server dev `.env` — `APP_URL=http://localhost:5173` (non-code).
