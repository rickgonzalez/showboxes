# Template Spec

> Status: descriptive — documents how the 15 built-in templates **actually**
> behave today, then flags the deviations that a follow-up cleanup pass should
> resolve. New templates added after this doc lands should follow the
> "Required" section as a contract.

The contract a template owes the Presenter is small (`Template` /
`TemplateHandle` in [registry.ts](../apps/player/src/templates/registry.ts)),
but the visual/layout conventions that make a template feel "right" inside the
player are mostly implicit. This doc makes them explicit.

---

## 1. The stage

The Presenter exposes three layered surfaces, all anchored to the same
`stageRoot` element so scene transitions move them together:

| Layer        | Owned by         | Coordinate space                          | Use for                                                   |
| ------------ | ---------------- | ----------------------------------------- | --------------------------------------------------------- |
| Canvas       | `presenter.stage`     | Pixels, origin top-left. `stage.width × stage.height` are CSS pixels (DPR handled internally). | Effect-driven text (`showTextBox`), 2D shapes, blits.     |
| DOM          | `presenter.domRoot`   | CSS box, `position: absolute; inset: 0`. `pointer-events: none` on the layer; children may re-enable. | Body text, code blocks, tables, anything that needs crisp HTML rendering. |
| 3D           | `presenter.stage3d`   | Three.js world units. Camera at `z=12`, fov 50° → visible plane ≈ **20 × 11.2** at `z=0` (16:9 worst case). Lazy — `null` if no 3D host was provided. | Graphs, spatial diagrams. Today only `flow-diagram` uses it. |

**Key shared invariant:** all three layers fill the same rectangle.
A template can mix them freely. Use canvas for "effect" text that needs
glow/slam/shake; use DOM for anything textual that the user might want to
read carefully.

---

## 2. Required: the `Template` contract

Every template MUST export a `Template` object satisfying:

```ts
{
  id: string;            // kebab-case, unique, matches the file name
  description: string;   // one sentence — appears in agent tool discovery
  slots?: Record<string, string>;   // human-readable schema hint
  demo?: TemplateDemo;   // sample payload for the demo UI
  render(presenter, content): TemplateHandle;
}
```

`render()` MUST return a `TemplateHandle` whose `dismiss()` removes
**everything** the template added across all layers and cancels every
timer / rAF / observer it started. Leaks here cause visible bleed-through
between scenes.

`emphasize(target)` is optional but strongly encouraged — the Producer uses
beats to pulse specific elements. See § 6.

---

## 3. Layout boundaries (the part nobody documented)

Today templates make different assumptions about their available space.
That's the root cause of the "they're all slightly different" feeling.
The convention going forward:

### 3.1 Safe area

The stage rectangle is `stage.width × stage.height` (DOM and canvas) or
~20×11 world units (3D). Templates SHOULD keep meaningful content inside
a **6% inset** on every side — that gives the chrome (transition wipes,
caption bar, future controls) room to live without clipping.

In practice: build inside a wrapper with `padding: 24px–32px` (DOM
templates) or scale 3D content to ≤ 90% of the camera frustum (the
`computeFitScale()` helper in `flow-diagram` is the reference impl).

### 3.2 Fill mode

Each template declares (in this doc, not in code yet) one of three
fill modes:

| Mode         | Behavior                                                  | Examples                                       |
| ------------ | --------------------------------------------------------- | ---------------------------------------------- |
| `full-bleed` | Wrapper is `position: absolute; inset: 0`; centers its own content. The template owns the whole stage. | `step-journey`, `data-pipeline`, `scorecard`, `entity-map`, `code-cloud`, `compare-split`, `transform-grid`, `directory-tree`, `sequence-diagram`, `flow-diagram` |
| `headed`     | Reserves the top ~180px for a canvas headline (via `showTextBox` at `y ≈ 120–140`); body fills the rest in DOM. | `title-bullets`, `purpose-bullets`             |
| `centered`   | A single canvas element placed at `stage.width/2, stage.height/2` (or just above). DOM subtitle optional. | `emphasis-word`, `center-stage`, `code-zoom`   |

This is the single most important standardization: **a template that
fights its declared fill mode looks broken next to the others.** When you
add a template, pick one and stick to it.

### 3.3 Content widths

DOM-heavy templates currently use ad-hoc `max-width` values:

| Template          | max-width            |
| ----------------- | -------------------- |
| `title-bullets`   | `min(820px, 80%)`    |
| `step-journey`    | `900px`              |
| `data-pipeline`   | `520px`              |
| `entity-map`      | `800px`              |
| `scorecard`       | `680px`              |

Recommendation: **standardize on three width tokens** —
`narrow: 520px`, `default: 720px`, `wide: 900px` — and have each template
pick one. Currently every template invents its own, which is why nothing
visually rhymes when you switch scenes.

---

## 4. Animation cadence

Templates today use these implicit defaults:

| Concern                 | Convention                                  | Notes                                              |
| ----------------------- | ------------------------------------------- | -------------------------------------------------- |
| Initial reveal delay    | `150–300ms` after mount                     | Gives the scene transition time to settle.        |
| Per-item stagger        | `120–300ms` for fast lists; `600–1500ms` for "stage" reveals | Tunable via `staggerMs` slot when applicable. |
| Entrance duration       | `400–500ms`                                 | `fx: slam` is `520–600ms`; `grow` is `500–700ms`. |
| Emphasize pulse         | `1200–1800ms`, then auto-revert             | Always self-cleans — never leaves an element lit. |
| Continuous motion       | **Avoid** unless the template name implies it (`center-stage` orbit, `code-cloud` float). Per the static-templates feedback. | "Calm" templates state this in their header doc. |

Numbers don't have to match exactly, but anything wildly outside these
ranges will feel out of place.

---

## 5. Color & styling tokens

There is no shared palette today; templates inline their own colors.
A small de-facto palette has emerged:

```
Surface bg:      #1e293b   (cards)
Surface border:  #334155
Stage bg text:   #f8fafc / #e2e8f0
Muted text:      #94a3b8
Mono font:       'JetBrains Mono', 'Fira Code', monospace
UI font:         Inter, system-ui, sans-serif

Palette aliases (resolved per-template, no central map):
  palette.primary    → #60a5fa  or  #3b82f6
  palette.secondary  → #a78bfa
  palette.accent     → #34d399
```

**Deviation:** `step-journey` resolves `palette.primary` to `#3b82f6`,
while `code-cloud`, `flow-diagram`, and `compare-split` resolve it to
`#60a5fa`. The PALETTE_DEFAULTS object is duplicated in three files. A
shared `palette.ts` would fix this.

---

## 6. The `emphasize(target)` contract

`emphasize` is the beat-driven "look here" hook. The convention is:

- `target` is a **string**, even when it represents an index.
- Numeric strings (`"0"`, `"1"`) address items by index where order is
  meaningful (`title-bullets`, `step-journey`, `scorecard`,
  `data-pipeline`, `transform-grid`, `sequence-diagram` steps).
- Non-numeric strings address by id/name (`flow-diagram` node id,
  `entity-map` entity id, `compare-split` `"left"|"right"`,
  `directory-tree` path or filename, `center-stage` orbiter text).
- `code-zoom` is the odd one out: target is a 1-based **line number**
  (still passed as a string).
- Emphasize MUST be safe to call on an element that hasn't finished its
  entrance yet (several templates use `revealStep()` first, then pulse).
- Emphasize MUST self-revert within ~1.5s. Never leave residual styling.

---

## 7. Demo payloads

Every template SHOULD ship a `demo: TemplateDemo` so the sample picker
can exercise it without bespoke wiring. The demo is also the de-facto
documentation of the slot schema — agents and humans both read it.

`emphasizeAfter` (optional) lets the demo trigger an emphasize call after
the animation has had time to settle. Use a delay that puts the pulse
**after** the entrance finishes but **before** the user gets bored
(2–6s is the sweet spot).

---

## 8. Per-template current state

| Template          | Fill mode  | Layers       | max-width | Calm/kinetic | Notes                                       |
| ----------------- | ---------- | ------------ | --------- | ------------ | ------------------------------------------- |
| title-bullets     | headed     | canvas + DOM | 820px     | mild stagger | Reference for "headed" mode.                |
| purpose-bullets   | headed     | canvas + DOM | (none — uses CSS class) | mild stagger | Like title-bullets, with typed icon rows.   |
| emphasis-word     | centered   | canvas + DOM | —         | kinetic      | The "mic drop". Used sparingly per design.  |
| center-stage      | centered   | canvas       | radius = `min(W,H)*0.3` | kinetic if `orbitSpeed > 0` | Orbit defaults off in spec; demo turns on. |
| code-zoom         | centered   | DOM          | —         | one-shot zoom | CSS transform; line-numbered emphasize.     |
| code-cloud        | full-bleed | DOM          | container | continuous float | Only template with continuous per-item motion by default. Consider muting. |
| transform-grid    | full-bleed | DOM          | container | mild stagger | Horizontal cards + connector glyphs.        |
| flow-diagram      | full-bleed | 3D + DOM     | 90% of frustum | optional camera orbit | Only 3D template. Has fit-to-frame logic — model after this. |
| sequence-diagram  | full-bleed | DOM + SVG    | container | step stagger | Hardcoded `HEADER_H/ROW_H` (px). Doesn't scale to short stages. |
| step-journey      | full-bleed | DOM          | 900px     | step stagger | Inline styles instead of CSS classes — outlier, see §9. |
| data-pipeline     | full-bleed | DOM          | 520px     | step stagger | Vertical. May overflow → uses `overflow-y: auto`. |
| scorecard         | full-bleed | DOM          | 680px     | mild stagger | Inline styles — outlier, see §9.            |
| entity-map        | full-bleed | DOM + SVG    | 800px     | mild stagger | Inline styles, manual line drawing. Outlier. |
| compare-split     | full-bleed | DOM          | (CSS)     | one-shot     | Two-panel; calmest of the kinetic set.      |
| directory-tree    | full-bleed | DOM          | (CSS)     | depth stagger then static | Explicitly calm — doc calls this out. |

---

## 9. Known deviations to fix

> **Working order (2026-04-15):** ~~tackle #2 (shared palette) → #5 (calm
> `code-cloud` by default) → #1 (extract inline styles to CSS classes)~~.
> All three of those landed under CS-19 — see the strikethroughs below.
> #7 (fit-to-frame) was resolved earlier the same day by the
> Three.js → SVG rewrite of `flow-diagram` (§9b).
> Remaining queue: #3, #4, #6, #8.


These are the gaps between the conventions above and what the code does:

1. ~~**Inline styles vs CSS classes.**~~ **Resolved (CS-19).**
   `step-journey`, `data-pipeline`, `scorecard`, `entity-map` now style
   themselves via `sb-<template-id>-*` classes in
   [index.css](../apps/player/src/index.css). Per-instance variation
   (grade colors, entity colors, active step color, column counts) flows
   through CSS custom properties; reveal/emphasize state flows through
   `.sb-visible` / `.sb-emphasize` classes.

2. ~~**Duplicate palette maps.**~~ **Resolved (CS-19).** Single source
   of truth lives in
   [`apps/player/src/templates/palette.ts`](../apps/player/src/templates/palette.ts);
   `code-cloud.ts`, `flow-diagram.ts`, and `compare-split.ts` import
   `PALETTE_DEFAULTS` and `resolveColor` from it. `palette.primary` is
   `#60a5fa` everywhere now.

3. **No shared safe-area constant.** Every template invents its own
   padding. **Fix:** export `SAFE_INSET = 24` (or a CSS var
   `--sb-safe-inset`) and have full-bleed wrappers use it.

4. **`sequence-diagram` uses pixel constants** (`HEADER_H = 72`,
   `ROW_H = 64`) tuned for a ~960px stage. Looks cramped on shorter
   stages, sparse on taller ones. **Fix:** scale these against
   `presenter.stage.height` like `flow-diagram` does for the 3D frustum.

5. ~~**`code-cloud` never stops moving.**~~ **Resolved (CS-19).** The
   continuous float is now opt-in via a `float?: boolean` slot
   (default `false`). Items still run their entrance animation; once
   landed they hold still. CSS gates the keyframe animation behind a
   new `.sb-cloud-float` class so the default render carries no
   perpetual motion.

6. **`center-stage` orbit defaults.** Spec says `orbitSpeed` defaults to
   `0` (static), which is correct, but the demo sets `0.003` and that's
   what users see first. Either change the demo or make the default
   match the demo — pick one.

7. ~~**`flow-diagram` is the only template that does fit-to-frame.**~~
   Resolved by the Three.js → SVG rewrite — see §9b. The other diagram-y
   templates (`entity-map`, `sequence-diagram`) still clip on large
   content; generalizing SVG `viewBox` fit-to-frame across them is a
   future task.

8. **`emphasize` target type drift.** Most templates accept
   "index-as-string OR name". A few are strict about one or the other.
   Document explicitly per template (§6 starts this) and add a
   `targetKind: 'index' | 'id' | 'either'` hint to `Template` so the
   Producer knows what to send.

---

## 9b. Architectural notes from the 2026-04-15 fit-to-frame work

While fixing `flow-diagram` to fit its frame, two cross-cutting issues
surfaced. Both belong here, not in the per-template fix list, because
they affect the whole player.

### Stages must use untransformed CSS size, not bounding rect

`Stage` and `Stage3D` originally measured their host with
`getBoundingClientRect()`, which returns **post-transform** pixels. The
codesplain hero embed (and any future embed that uses CSS
`transform: scale(...)` to fit a fixed design surface into a flexible
slot) wraps the player in a 1280×1280 div that's then scaled down. The
bounding rect reports the scaled-down size; the canvases were authored
against the design size. The mismatch produced:

- Tiny / invisible WebGL meshes (backbuffer sized to the wrong dimensions).
- DOM-projected CSS3D labels clustered in one corner of the frame.
- 2D canvas effects positioned at the wrong coordinates.

**Fix:** both stages now read `host.clientWidth/clientHeight` (which
ignore CSS transforms). Templates author against the design surface;
the surrounding CSS transform handles the visual scale uniformly.

**Implication for new templates:** never read `getBoundingClientRect()`
to size a render surface. Use `clientWidth/Height`, or pass the design
size in explicitly. This matters most for canvas/WebGL/SVG `viewBox`
work where backbuffer resolution is decoupled from on-screen pixels.

### 3D in a scalable player has poor cost/benefit at small sizes

Even with sizing fixed, `flow-diagram` (the only 3D template) reads as
weak at small embed sizes: WebGL boxes become sub-pixel ghosts because
the GL rasterizer can't anti-alias 2px-wide edges below a certain
physical scale, while the CSS2D labels (DOM-rendered) stay crisp.
The 3D-ness of `flow-diagram` was always cosmetic — labelled
rectangles connected by arrows are fundamentally a 2D graph, and the
camera dolly was an awkward way to do `viewBox` scaling.

**Decision (2026-04-15):** rewrite `flow-diagram` in SVG + DOM.
SVG `viewBox` gives `object-fit: contain` for free, scales crisply at
any size, shares the DOM rasterizer with labels, and removes the
WebGL/Three.js cost from the baseline player bundle.

**Stage3D is kept** — it's the right tool for templates that genuinely
need depth, lighting, or true 3D camera moves. We just stop using it
for "I want a 2D diagram with a slight lift."

**Implication for new templates:** default to SVG + DOM for diagrams.
Reach for Stage3D only when the visual literally needs the third
dimension. If a future template wants the "card lifted off the page"
feel, do it in SVG with a drop shadow before reaching for WebGL.

---

## 10. Adding a new template — checklist

- [ ] File: `apps/player/src/templates/<id>.ts`, exporting `<id>Template: Template`.
- [ ] Registered in [`templates/index.ts`](../apps/player/src/templates/index.ts).
- [ ] Pick a fill mode (§3.2) and stick to it.
- [ ] Pick a width token (§3.3).
- [ ] Use CSS classes in [`index.css`](../apps/player/src/index.css), not inline styles.
- [ ] `dismiss()` clears every timer, rAF, observer, and DOM/canvas/3D node.
- [ ] `emphasize()` self-reverts in ≤ 1.8s.
- [ ] Ship a `demo` payload.
- [ ] Decide calm vs kinetic and say so in the file header — default to calm.
- [ ] If 3D: implement fit-to-frame against `stage3d.width/height`.
- [ ] Add a row to the table in §8 of this doc.
