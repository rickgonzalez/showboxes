# Embed & Auth — Viewer-First Plan

This doc locks in the posture that falls out of the AUTH-AND-BILLING-PLAN follow-up about cross-origin session cookies. The short version: **authoring lives on the home origin; embeds are viewer-only.** Third-party credentialing (tenant API keys, end-user bearer tokens, origin-bound publishable keys) is deferred until a paying customer asks for in-embed authoring.

## Why this shape

Two products are layered inside the same app:

1. **Authoring** — someone runs a repo through Agent 1b, burns credits, gets a Script. Expensive, authenticated, billed.
2. **Viewing** — someone opens a saved Script and watches it play. Cheap, no LLM calls, safe to embed anywhere.

Today the player does both from inside the embed surface. That's what forces the estimate call, the balance chip, and the "whose session is this?" question into viewer context on a third-party origin — which is also the direct cause of the `sign in to see your balance` bug called out in AUTH-AND-BILLING-PLAN.md §Follow-ups.

If viewing never triggers authoring, the whole cross-origin auth problem collapses:
- No `/api/analyze` call from the embed → no reservation → no balance lookup → no session cookie needed on a foreign origin.
- The embed's only network calls are read-only, scoped by the Script's own id.
- Authoring stays on codesplain.io, same-origin, with the existing cookie session working unchanged.

A bonus fallout: authoring-only-on-home-origin is exactly what an **on-prem / private intranet** deployment wants. An enterprise can stand up their own codesplain instance inside the firewall, run analyses there, and embed the resulting Scripts on their internal wikis/docs without credentials ever leaving their network.

## Two embed modes

```
<codesplain-viewer script-id="..." />   // Day 1. Anonymous, read-only, cross-origin safe.
<codesplain-studio tenant-key="..." />  // Future. Authoring-capable, tenant-billed. Not built.
```

Only the first ships. The second is a documented shape so we don't paint ourselves into a corner.

## What's in v1 (viewer-only embed)

### Schema

Additive to [`apps/server/prisma/schema.prisma`](apps/server/prisma/schema.prisma):

```prisma
// Add to existing Script model:
//   visibility  String   @default("private")   // 'private' | 'unlisted' (v1); 'public' reserved for later
//   shareToken  String?  @unique                // random 32-byte, URL-safe, required when visibility='unlisted'
//   userId      String?                         // owner; nullable for legacy rows
//   @@index([shareToken])

// Add to existing Analysis model:
//   userId      String?  // owner; nullable for legacy rows
//   @@index([userId])
// (No visibility or shareToken on Analysis — it is owner-only and never
// user-addressable. See Decided §Analysis visibility.)
```

Migration: additive, nullable, default `private` on Script.visibility. Legacy Scripts stay private until the owner opts in. Legacy Analyses get `userId = null`, which makes them unreachable by `canReadAnalysis` — the owner is unknown and they're effectively archived. No `User.ownedScripts`/`ownedAnalyses` relations needed yet — plain `userId` columns are enough for v1.

### Access rules

One function, one place. Pseudocode for `canReadScript(script, req)`:

```
if script.visibility === 'unlisted' → allow iff req carries the matching shareToken
if script.visibility === 'private'  → allow iff requireUser(req).id === script.userId
// 'public' intentionally not implemented in v1 — reject until we build it.
```

Apply to:
- `GET /api/scripts/:id`
- `GET /api/scripts` (filter the list to readable ones)
- `POST /api/notes` — **author-only.** Require `requireUser(req)` and reject unless `user.id === script.userId`. Notes are a me-and-Claude tuning tool, not a viewer feature (see Decided §Notes).

**Analysis is not user-addressable.** Analyses are internal intermediate artifacts — the UI never surfaces them as a standalone resource. `canReadAnalysis` is a one-liner: `analysis.userId === requireUser(req).id`. No `visibility` column, no `shareToken`, no public read path. See Decided §Analysis visibility.

### Player changes

Add a viewer-mode prop to the player entry point. When in viewer mode:
- No triage modal, no TriageModal dead code path.
- No calls to `/api/triage`, `/api/analyze`, `/api/analyze/estimate`, `/api/script`, `/api/auth/me`, `/api/credits/*`.
- Reads only: `GET /api/scripts/:id?token=...`.
- **No flag/notes button.** Notes are an author-mode feature only.

The existing non-embed player on codesplain.io keeps all its current capabilities — it's author-mode by default.

### Dev-loop CORS fix (small, separate)

The bug that started this thread (player on `:5173` can't see the server's cookie on `:3001`) is a **development-only** issue once authoring moves to the home origin. In production the player runs same-origin as the server. Fix options in dev:

- **Preferred:** Vite proxy in the player's dev server — rewrite `/api/*` to `http://localhost:3001`. Player then fetches relative URLs; browser thinks it's same-origin; cookie rides along. ~10 lines in `apps/player/vite.config.ts`. No server-side CORS changes at all.
- **Alternative:** tighten `next.config.ts` CORS to the specific player origins with `Access-Control-Allow-Credentials: true`, flip player fetches to `credentials: 'include'`. Works but is two-sided.

Go with the Vite proxy. It's one-sided and makes dev look like prod.

### Embed HTML (later, not blocking)

The marketing-site embed can be as simple as:

```html
<script src="https://codesplain.io/embed.js" data-script-id="..."></script>
```

`embed.js` mounts a shadow-DOM-isolated iframe pointed at `https://codesplain.io/viewer/:scriptId` and sizes it responsively. The iframe's origin is codesplain.io, so cookies are irrelevant — the script is rendered server-side-public or via shareToken in the URL.

No separate embed infra required for v1; the iframe URL *is* the embed. `embed.js` is optional polish.

## What's deferred (tenant keys / in-embed authoring)

Written down here so we don't have to rediscover it later.

When the first enterprise asks for in-embed authoring:

1. **`ApiKey` model.** `{ id, userId (tenant owner), hashedKey, allowedOrigins: string[], rateLimit, billingPolicy: 'tenant' | 'end_user' | 'either', revokedAt }`. Publishable keys (`pk_live_...`) go in page source; server rejects any call whose `Origin` header isn't in `allowedOrigins`.
2. **Optional end-user bearer.** Short-lived (~15m) opaque access token + refresh token, Stripe/Intercom-style. Only needed if an enterprise wants to attribute usage to named end users. Day 1 is anonymous-metered-to-tenant.
3. **Credit attribution.** Default is tenant-pays; per-key flag allows end-user-pays when a bearer is present.
4. **Studio mode.** `<codesplain-studio tenant-key="...">` enables the triage modal and `/api/analyze` calls from inside an embed. Everything above (origin binding, billing policy, rate limits) exists to make that safe.

None of this is built. The `ApiKey` table doesn't exist. Don't add columns "in case" — the day this matters, a one-week sprint stands it up cleanly.

## Rollout order

Each is a small, independently-commitable PR.

1. **Schema:** `Script.visibility`, `Script.shareToken`, `Script.userId`, `Analysis.userId`. Migration additive. ✅ **Done 2026-04-17.** Applied via `prisma db push` against the shared RDS instance. `Analysis.userId` pre-existed from the auth-and-billing work; this PR added the three `Script` columns plus `@@index([userId])` and `@@index([shareToken])`. Legacy Script rows remain `visibility='private'`/`userId=null`, which `canReadScript` rejects — matches the "grandfather as unreachable" decision.
2. **`canReadScript` + `canReadAnalysis` helpers and apply to read routes.** ✅ **Done 2026-04-17.** New module at [apps/server/lib/access/index.ts](../../apps/server/lib/access/index.ts) with one decision function each and an `extractShareToken(req)` helper. Applied to:
   - [`GET /api/scripts/:id`](../../apps/server/app/api/scripts/[id]/route.ts) — auth-optional; runs `canReadScript`; redacts `usage` (cost rollup) to `null` for non-owners so unlisted viewers don't see the meter.
   - [`GET /api/scripts`](../../apps/server/app/api/scripts/route.ts) — owner-scoped list; anonymous callers get `{ scripts: [] }`.
   - [`GET /api/scripts/:id/replay`](../../apps/server/app/api/scripts/[id]/replay/route.ts) — same access check as the record endpoint.
   - [`GET /api/scripts/:id/cost`](../../apps/server/app/api/scripts/[id]/cost/route.ts) — owner-only hard stop. Even a valid shareToken doesn't unlock cost data.
   - [`GET /api/analyses`](../../apps/server/app/api/analyses/route.ts) and [`GET /api/analyze/:id`](../../apps/server/app/api/analyze/[id]/route.ts) — owner-only (`canReadAnalysis`).
   - [`POST /api/notes`](../../apps/server/app/api/notes/route.ts) — `requireUser` + ownership check on the referenced Script row. `scriptId` is now required (tightened from nullable) so sample/fixture scripts can't be flagged.

   Response codes: `not_found`/`forbidden`/`unauthorized` map to 404/403/401; we prefer 404 over 403 when the caller isn't authenticated-as-owner so we don't reveal which ids exist.
3. **Ownership wiring.** ✅ **Done 2026-04-17.** `/api/analyze` already persists `userId` on Analysis.create (from the auth-and-billing work). `/api/script` now captures `requireUser`'s return value and sets `userId` + `visibility: 'private'` on Script.create ([apps/server/app/api/script/route.ts](../../apps/server/app/api/script/route.ts)).
4. **Player viewer-mode prop.** ✅ **Done 2026-04-17 — shipped as a dedicated [apps/player/src/Viewer.tsx](../../apps/player/src/Viewer.tsx) component rather than a prop on `App`.** Rationale: `App` is the internal exerciser with the full template/effect toolbar; a viewer-mode flag would have been a pile of conditionals. The new `Viewer` is player-only — `Presentation` + `ScriptPlayer` + minimal play/pause. Zero calls to `/api/triage`, `/api/analyze`, `/api/script`, `/api/auth/me`, `/api/credits/*`, or `/api/notes`; the only network call is the single `fetchViewerScript` against `/api/scripts/:id/replay?token=…`. Voice defaults to `'off'` (stub) so embeds on unknown pages don't autoplay audio by surprise. Related api.ts changes: added `credentials: 'include'` to `listAnalyses`/`listScripts`/`getScript`/`postNote` (previously missing — would 401 now that the routes are gated); tightened `PostNoteInput.scriptId` from nullable to required.
5. **Vite proxy for the dev loop.** ⏳ **Pending.** Unblocks the current cross-origin cookie bug — rewrite `/api/*` in [apps/player/vite.config.ts](../../apps/player/vite.config.ts) to forward to `http://localhost:3001`. One-sided change, ~10 lines, no server-side CORS churn.
6. **Public `/viewer/:scriptId` route.** ✅ **Done 2026-04-17.** Routed in [apps/player/src/main.tsx](../../apps/player/src/main.tsx) — path match `/viewer/:id` with an optional `?token=` query forwarded to `Viewer`. Shows distinct error copy for 404 / 401 (token required) / 403 (token invalid or rotated).
7. **(Optional) `embed.js` drop-in script.** ⏳ **Pending.** Iframe mounter + resize. Only if the marketing site or early customers need it; the iframe URL alone is sufficient.

### Not in any step, but also pending

- **Share-flow UI.** There is no surface today for an owner to flip a Script from `private` → `unlisted` or to rotate an existing `shareToken`. Every Script created under the new code lands as `private` with `shareToken: null`, meaning the `/viewer/:id` route is currently owner-only in practice. Adding a "Share" action in the GenerateFlow state-6 chrome is the smallest useful PR — server-side it's a single `prisma.script.update` that randomizes `shareToken` and sets `visibility: 'unlisted'`.
- **StageCosts redaction elsewhere.** Only `Script.usage` is redacted today. If any future response surfaces `Analysis.stageCosts` to a non-owner, re-check the redaction rule before shipping.

## Watch-outs

- **Don't leak StageCosts on unlisted Scripts.** Cost data is an internal signal — redact `usage` and any `stageCosts` from the response when the caller isn't the owner. Unlisted viewers see the Script, not the meter.
- **`/api/notes` is currently unauthenticated.** The route takes any `scriptId` and writes a note — a latent spam vector even today. Locking it to `requireUser` + `user.id === script.userId` is a few lines and should land with the rest of the access-rule work, not later.
- **Share-token rotation.** Unlisted is "security by obscurity." Give owners a button to rotate the token (invalidates existing embeds). Not MVP, but the column should exist so rotation is a one-row update.
- **Migration choice on legacy rows.** Grandfather all existing Scripts as `private` owned by… nobody (`userId = null` stays null, which `canReadScript` will reject). Breaks existing share links, but there aren't real external users yet. Owners can re-share as unlisted on demand.
- **On-prem pathway.** Keep the server self-contained (no hard dep on codesplain.io-specific services). Magic-link email provider is the one environment-specific bit; the rest is Prisma + Next + Anthropic SDK, which all work inside a firewall given outbound access to Anthropic.

## Decided

- **Visibility model for v1: `private` + `unlisted` only.** No `public`. The `visibility` column is stored as a string so `public` can be added later without a migration. Decided 2026-04-17.
- **Notes are author-only.** Viewer-mode embeds do not render the flag button. `/api/notes` is locked to `requireUser` + owner-match. Notes remain an internal tuning tool for the core platform; enterprise-edition annotation/review flows are a separate conversation. Decided 2026-04-17.
- **Analysis visibility: none.** Analyses are internal intermediate artifacts. The user flow (see upcoming GENERATE-FLOW-PLAN) runs triage → analysis → script as a single unbroken pipeline; the Analysis is never surfaced as its own screen, URL, or shareable resource. Access is owner-only via `userId`; no visibility toggle, no shareToken, no public route. If a future mode needs user-visible Analyses, add visibility then. Decided 2026-04-17.
- **Private-repo handling is out of scope for this doc.** How we treat Scripts generated from private GitHub repos (enterprise-only? watermarks? extra access checks?) is a separate conversation.

---

## Update — 2026-04-18 (prod routing — same-origin shipped)

This doc's §Embed HTML had always assumed `https://codesplain.io/viewer/:scriptId` — i.e. viewer lives same-origin with the server. Until this session that was aspirational: prod was actually two deployments (Next at `codesplain.io`, Vite SPA at a separate Vercel URL pointed to by `NEXT_PUBLIC_PLAYER_URL`). `transpilePackages` let Next *import* player components (e.g. `HeroPlayer` on the landing page) but did **not** bring the player's path-based router ([apps/player/src/main.tsx](../../apps/player/src/main.tsx)) into Next. Hitting `codesplain.io/generate` or `codesplain.io/viewer/:id` 404'd.

### What shipped

- **Next routes mounting player components same-origin:**
  - [apps/server/app/generate/page.tsx](../../apps/server/app/generate/page.tsx) → `GenerateFlow`.
  - [apps/server/app/viewer/[id]/page.tsx](../../apps/server/app/viewer/%5Bid%5D/page.tsx) → `Viewer` with `scriptId` + `?token=` from `useParams`/`useSearchParams`. This is the concrete URL the §Embed HTML section assumes.
- **Subpath exports** on [apps/player/package.json](../../apps/player/package.json) for `./pipeline/GenerateFlow` and `./Viewer`. Barrel (`.`) unchanged.
- **SSR guards** on `import.meta.env` in [apps/player/src/pipeline/api.ts:26](../../apps/player/src/pipeline/api.ts#L26) and [apps/player/src/Viewer.tsx:33](../../apps/player/src/Viewer.tsx#L33). Under Next SSR `import.meta.env` is `undefined`; guarded access falls back to `SERVER_URL = ''` which is correct for same-origin prod. No effect in Vite.
- **Landing page** ([apps/server/app/page.tsx](../../apps/server/app/page.tsx)) — `PLAYER_URL` constant deleted; all player links point at same-origin `/generate`.
- **Retire** the old `showboxes-player-*.vercel.app` deployment after a clean prod walkthrough.

### Why this matters for the embed

Viewer embeds were always going to be simplest with same-origin: the iframe URL is just `https://codesplain.io/viewer/:scriptId?token=…`, no cookie-domain gymnastics, no CORS-with-credentials. This update makes that real rather than aspirational.

### Dev-loop CORS fix — still applies, as-is

The §Dev-loop CORS fix remains a **dev-only** concern. In dev, player on `:5173` → server on `:3001` is still two origins, and the Vite proxy described above is the right fix. The ambient `Access-Control-Allow-Origin: *` in [next.config.ts](../../apps/server/next.config.ts) is dead code in prod now that origins collapse; kept because it's still useful in dev for tooling that bypasses the proxy.

### Prod env requirement (surfaced in the same walkthrough)

`APP_URL=https://www.codesplain.io` must be set in prod. Magic-link emails and the post-verify redirect read it; unset falls back to `http://localhost:3001`. `NEXT_PUBLIC_PLAYER_URL` is no longer read and can be unset.
