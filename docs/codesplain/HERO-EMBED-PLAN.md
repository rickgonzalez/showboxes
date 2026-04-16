# Hero Embed Plan — Embedding the Player in the Landing Page

## Goal

Replace the placeholder HeroLottie in the codesplain landing page with the real Showboxes player, looping two scenes:

1. The **login sequence diagram** (from `sampleScripts` — scene `s2b`, template `sequence-diagram`)
2. The **code-cloud** scene (from the stress-test sample — scene `stress-1`, template `code-cloud`)

The hero motion *is* the product motion. No iframe, no duplicated assets, and minimal impact on the existing player codebase.

## Why option 2 (workspace import) over iframe or library build

- The player already re-exports a clean public API from `apps/player/src/player/index.ts` (`ScriptPlayer`, `StubVoicePlayer`, `sampleScripts`, types).
- The React wrapper `apps/player/src/react/Presentation.tsx` is already isolated from the demo `App.tsx`.
- The monorepo is already configured with npm workspaces (`apps/*`).
- No iframe chrome, cross-origin voice weirdness, or scrollbars.
- Forces a minimal public surface for `@showboxes/player` — which we'll need anyway for the DISTRIBUTION.md widget mode.

## Non-goals for this pass

- **No changes to player internals.** No edits to templates, Presenter, ScriptPlayer, samples, or player styles. Only an additive index barrel that re-exports the pieces the server needs.
- **No voice.** Hero uses `StubVoicePlayer` (silent). Narration captions are a later layer.
- **No controls.** It's ambient motion, not an interactive demo. No play/pause/seek UI.
- **No SSR.** The player touches canvas/DOM on mount, so the server page uses `next/dynamic` with `ssr: false`.

## Moving pieces

### 1. Player — tiny additive export (`apps/player/src/index.ts`)

New file. Re-exports the public API the server consumes:

```ts
export { Presentation } from './react/Presentation';
export type { PresentationProps } from './react/Presentation';
export * from './player';           // ScriptPlayer, StubVoicePlayer, types, sampleScripts
export * from './templates';        // side-effect: registers built-in templates
```

Also bump `apps/player/package.json` to add a `"main"` / `"types"` pointer so Next can resolve `@showboxes/player`.

The existing `apps/player/src/main.tsx` (the Vite demo entry) is untouched.

### 2. Shared style isolation

The player's `index.css` is large (includes every template's styles) and is currently imported by `main.tsx`. To avoid pulling it into the Next bundle via a side-effecting ESM import, the server's hero component imports `@showboxes/player/src/index.css` explicitly through a Next client-side dynamic loader. Styles are scoped enough (`.sb-*` prefixes on template containers) that they shouldn't collide with codesplain's own CSS — but the hero wrapper adds a `.hero-player-scope` class and a CSS containment boundary as a belt-and-suspenders measure.

### 3. Server — new component (`apps/server/app/components/HeroPlayer.tsx`)

Client component. Responsibilities:

- `'use client'` — uses refs and effects.
- Imports `Presentation`, `ScriptPlayer`, `StubVoicePlayer`, `sampleScripts` from `@showboxes/player`.
- Builds a small two-scene `PresentationScript` on the fly by **slicing** scenes out of the existing samples (no new fixture files). Something like:

  ```ts
  const heroScript: PresentationScript = {
    meta: { ...loginSample.meta, title: 'Codesplain hero', estimatedDuration: 20 },
    defaults: { ...loginSample.defaults, voice: { provider: 'stub', voiceId: 'stub-1', speed: 1 } },
    scenes: [
      findScene(loginSample, 's2b'),          // sequence-diagram
      findScene(stressSample, 'stress-1'),    // code-cloud
    ],
  };
  ```

  This is pure composition — no new scene authoring, no touching the player samples.
- On mount, creates a `ScriptPlayer(heroScript, presenter, new StubVoicePlayer())` and calls `.play()`.
- Subscribes to `onEnded` and re-invokes `.play()` from scene 0 to loop forever.
- Cleans up on unmount (`player.stop()`).
- Fallback: if import fails in dev (workspace not installed yet), renders the existing `HeroLottie` component so the page still looks fine.

### 4. Server — swap in the hero visual (`apps/server/app/page.tsx`)

`HeroLottie` is replaced with `HeroPlayer` inside `.hero-visual`. The floating `.float-card.one/.two` stays (they read nicely on top of the motion). `HeroPlayer` is loaded via `dynamic(() => import('./components/HeroPlayer'), { ssr: false, loading: () => <HeroLottie /> })` so server render + hydration are both clean.

### 5. Server — `package.json` + `next.config.ts`

- Add `"@showboxes/player": "*"` to server dependencies.
- `next.config.ts` gets `transpilePackages: ['@showboxes/player']` so Next compiles the player's TSX/CSS rather than expecting pre-built JS.

### 6. Aspect + palette adjustments

The player scenes were authored against a **dark** palette. On our cream/sky hero, we override `defaults.palette` on the in-flight script to use the Codesplain brand blues:

```ts
palette: {
  primary:    '#1d7ab7',
  secondary:  '#6fc4eb',
  accent:     '#155a88',
  background: '#ffffff',
  text:       '#0e2235',
  code:       '#3e5572',
},
```

So the same templates render on-brand without touching the sample fixtures.

## File manifest

New files (all additive):

- `apps/player/src/index.ts` — package barrel
- `apps/server/app/components/HeroPlayer.tsx` — embed component
- `docs/codesplain/HERO-EMBED-PLAN.md` — this doc

Edits:

- `apps/player/package.json` — add `main` / `types` pointing at `src/index.ts`
- `apps/server/package.json` — add `@showboxes/player` dep
- `apps/server/next.config.ts` — add `transpilePackages`
- `apps/server/app/page.tsx` — swap `HeroLottie` → `HeroPlayer` (with Lottie as fallback)

Untouched:

- All of `apps/player/src/App.tsx`, templates, samples, player core, Presenter, ScriptPlayer
- Existing landing page layout, nav, sections, footer

## Risk notes

- **React version match.** Player is on React 18.3.1; server is 18.3.1. Safe.
- **Three.js on the hero.** Sequence + code-cloud are canvas + DOM — they don't pull Three.js (that's `flow-diagram` territory). So the hero bundle stays lean.
- **Motion budget.** Two scenes x ~10-14s holds = ~25s loop. Acceptable. If it feels heavy we can trim `holdSeconds` in the hero-local script without touching samples.
- **Accessibility.** Wrap the player in a `role="img"` container with an aria-label describing what's playing; respect `prefers-reduced-motion` by showing the Lottie fallback instead.

## Execution order

1. Write `apps/player/src/index.ts` barrel and bump its `package.json`.
2. Edit `apps/server/{package.json, next.config.ts}` for the workspace import.
3. Write `HeroPlayer.tsx` with composed script + looping + reduced-motion branch.
4. Swap the hero visual in `page.tsx` behind `next/dynamic`.
5. Spot-check: server dev on :3001 renders the player, scenes loop, brand blues land, no console errors, Lottie fallback kicks in when JS is disabled / reduced-motion is on.
