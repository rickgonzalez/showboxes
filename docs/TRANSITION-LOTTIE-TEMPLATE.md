# `transition-lottie` — Template Contract

Lottie-driven scene transitions for the showboxes Script Player. Authored in **Lottie Creator** (or After Effects + Bodymovin as a fallback), played on the existing 2D canvas via `lottie-web`'s canvas renderer. Intended as an **intermittent** visual variation tool: the Producer/Director (Agent 2) is instructed to use 1–3 per script, no more.

Supersedes the earlier sprite-based draft — vector Lottie matches the existing template aesthetic (canvas 2D + anime.js, DOM overlays) better than pixel-art sprites, scales crisply at any stage size, and gives us direct access to the lottiefiles.com library so we rarely need to author from scratch.

Companion to [ARCHITECTURE.md](./ARCHITECTURE.md). See also the visual primitive catalog in `PRODUCER_SYSTEM_PROMPT` (`apps/server/lib/agents/producer.system-prompt.ts`).

---

## 1. Purpose and constraints

**What this template is for:** giving long-running, detail-heavy presentations occasional kinetic breaks. A short Lottie animation (0.8–1.5s) that plays between scenes — or at the top of a scene as an establishing beat — so the viewer's eye gets a visual reset.

**What it is not:** a narrator of content. Transitions carry no narration and no informational payload. If a scene needs to explain something, use a content template (`title-bullets`, `code-zoom`, etc.), not this.

**Hard limits:**
- Max **3 transitions per script**, enforced at the producer prompt level + validated in `produceScript()`.
- Duration capped at **1.5 seconds** of actual animation. Any "hold" after the animation belongs to the next scene.
- No narration, no voice. Voice continues seamlessly from the previous scene if mid-narration; otherwise pauses cleanly.
- Agent 2 picks a `transitionId` from a **strict enum** in the tool schema — it cannot invent names. Each enum entry maps to a committed `.json` file on disk.

---

## 2. Slot schema

```typescript
interface TransitionLottieScene {
  template: "transition-lottie";
  content: {
    /**
     * Which transition to play. Enumerated in the tool schema — the model
     * picks from the catalog, it cannot invent names.
     */
    transitionId: TransitionId;

    /**
     * Playback speed multiplier. 1.0 = author-intended speed from the
     * Lottie file's framerate. Range 0.5–2.0. Default 1.0.
     */
    speed?: number;

    /**
     * Optional palette override. Lottie supports runtime color swapping
     * via named layers. If the transition was authored with a "primary"
     * layer color, this hex value replaces it at load time.
     * Example: "#22c55e". Default: use the author's colors.
     */
    primaryColor?: string;

    /**
     * Positioning on stage. Default "fullscreen".
     * - "fullscreen": scales to cover the stage, preserving aspect ratio
     *   (letterboxed if the composition aspect doesn't match).
     * - "center": drawn at the composition's native size, centered.
     */
    placement?: "fullscreen" | "center";
  };

  /**
   * Total scene duration. For transitions, this is the animation's
   * intrinsic length + a short pad (100–200ms). The runtime clamps
   * holdSeconds to [animationDuration, 2.0].
   */
  holdSeconds: number;

  /** Transitions have no beats. Field ignored by the renderer if present. */
  beats?: never;

  /** Transitions are silent. */
  narration?: "";
}

type TransitionId =
  | "wipe-horizontal"
  | "wipe-diagonal"
  | "dot-dissolve"
  | "iris-close"
  | "iris-open"
  | "stinger-bolt"
  | "stinger-pop"
  | "morph-shapes"
  | "line-sweep";
// (Starter catalog — expand as files are added.)
```

---

## 3. Lottie asset contract

Each `TransitionId` maps to one committed file:

```
apps/player/public/transitions/{transitionId}.json
```

### 3a. File requirements

- Produced by **Lottie Creator**, or **After Effects + Bodymovin** (JSON export, no images embedded).
- **No rasters.** Pure vector only. This keeps files small and avoids the canvas-renderer image-loading caveats. Bodymovin's "Export → Standard" without "Include in JSON" for images is the setting; Creator is vector-only by default.
- **No expressions.** Bodymovin flags these on export; remove before shipping. Creator doesn't support expressions, so Creator-authored files are safe by construction.
- **Framerate:** 30 or 60 fps. Both render fine on the canvas renderer.
- **Composition size:** **1920×1080** for `fullscreen` transitions, **512×512** for `center` stingers. The player scales at draw time.
- **File size budget:** ≤ 40 KB per transition. Most decent Lottie transitions land at 5–20 KB. If you're over budget, it's usually too many shape layers — simplify.
- **Duration:** ≤ 1.5s at 1.0x speed. Trim any tail.

### 3b. Naming convention for runtime color override

If a transition has a single "primary" accent color we want to override at runtime, the author must name the fill/stroke layer **`primary`** (lowercase) in the composition. Our loader walks the JSON, finds layers named `primary`, and rewrites their color channels before handoff to `lottie-web`.

Lottie layer naming works in both Creator and AE. In Creator it's the Layer name in the Layers panel; in AE it's the Layer name in the Timeline (not the source file name).

Transitions that should not support recoloring simply omit this name — the `primaryColor` option is then a silent no-op.

### 3c. What NOT to include

- **No images / raster assets.** Pure vector shapes only.
- **No audio tracks.** Transitions are silent per §1.
- **No text layers** with system-font dependencies. If a transition needs text, convert to outlines/shapes before export.
- **No external references.** The JSON must be fully self-contained.

---

## 4. Runtime — `lottie-web` canvas integration

Lives at `apps/player/src/primitives/transitionLottie.ts`. Depends on `lottie-web` (`npm i lottie-web`; ~250 KB min+gz for the full build, ~60 KB for the canvas-only build).

**Recommended import:** the canvas-only build to keep bundle size down:

```typescript
import lottie from "lottie-web/build/player/lottie_canvas";
```

Sketch of the player (replaces the ~50-line sprite player from the earlier draft):

```typescript
import lottie, { AnimationItem } from "lottie-web/build/player/lottie_canvas";

type TransitionOpts = {
  speed?: number;
  primaryColor?: string;
  placement?: "fullscreen" | "center";
};

// Simple in-memory cache so we parse each JSON once per session.
const cache = new Map<TransitionId, object>();

async function loadLottie(id: TransitionId): Promise<object> {
  if (cache.has(id)) return cache.get(id)!;
  const data = await fetch(`/transitions/${id}.json`).then(r => r.json());
  cache.set(id, data);
  return data;
}

/** Walk the Lottie JSON and rewrite any layer named `primary` to the given hex. */
function applyPrimaryColor(data: any, hex: string): any {
  const [r, g, b] = hexToRgbNormalized(hex); // e.g. "#22c55e" -> [0.13, 0.77, 0.37]
  const clone = structuredClone(data);
  const visit = (layer: any) => {
    if (layer?.nm === "primary" && Array.isArray(layer.shapes)) {
      for (const shape of layer.shapes) {
        for (const item of shape.it ?? []) {
          if (item.ty === "fl" || item.ty === "st") {
            item.c.k = [r, g, b, 1];
          }
        }
      }
    }
    (layer.layers ?? []).forEach(visit);
  };
  (clone.layers ?? []).forEach(visit);
  return clone;
}

export async function playTransition(
  ctx: CanvasRenderingContext2D,
  id: TransitionId,
  opts: TransitionOpts = {}
): Promise<void> {
  const raw = await loadLottie(id);
  const data = opts.primaryColor
    ? applyPrimaryColor(raw, opts.primaryColor)
    : raw;

  // lottie-web's canvas renderer wants a context, not an element.
  // It draws into the ctx we hand it. We do NOT clearRect — the Presenter
  // already cleared the stage before calling us.
  const anim: AnimationItem = lottie.loadAnimation({
    renderer: "canvas",
    loop: false,
    autoplay: false,
    animationData: data,
    rendererSettings: {
      context: ctx,
      clearCanvas: true, // lottie clears between frames for us
      preserveAspectRatio:
        opts.placement === "center"
          ? "xMidYMid meet" // native size, centered
          : "xMidYMid slice", // fullscreen cover — crops if aspect mismatch
    },
  });

  if (opts.speed) anim.setSpeed(opts.speed);

  return new Promise(resolve => {
    anim.addEventListener("complete", () => {
      anim.destroy();
      resolve();
    });
    anim.play();
  });
}
```

Integration in the Presenter's scene loop:

```typescript
case "transition-lottie":
  await playTransition(ctx, scene.content.transitionId, {
    speed: scene.content.speed,
    primaryColor: scene.content.primaryColor,
    placement: scene.content.placement,
  });
  // Transitions don't schedule beats and don't speak. ScriptPlayer still
  // honors holdSeconds; playTransition typically resolves close to it.
  break;
```

**Why canvas-only build:** matches the existing Stage canvas architecture (no extra DOM overlay for transitions), keeps bundle small, and the SVG renderer's extra features (hit-testing, CSS styling) aren't useful for silent fire-and-forget transitions.

**Caveats to know:**
- `lottie-web`'s canvas renderer does not support all Lottie features (e.g., masks with complex modes, some blend modes). For simple vector transitions this is fine. If an animation renders wrong on canvas, try it in Creator's preview (SVG-based) — if it looks right there but not in our runtime, the feature isn't supported on canvas. Simplify the source.
- The `clearCanvas: true` option means each transition frame clears what was underneath. If you ever want a transition to composite *over* previous scene content, set `clearCanvas: false` and manage clearing in the Presenter — but for scene-to-scene transitions the default is correct.

---

## 5. Agent 2 guidance (producer prompt additions)

Add to `PRODUCER_SYSTEM_PROMPT`:

> **Transitions (`transition-lottie`).** You have access to a small catalog of Lottie-based transitions for visual variation in long presentations. Use them **sparingly**: **1–3 per script, never more**. They carry no narration and no information — their only job is to give the viewer a kinetic break between dense content scenes. Good placements:
> - After a heavy `code-zoom` run, before shifting to a new subsystem.
> - Between major analysis sections (e.g. architecture → code quality).
> - At the top of the final section as a stinger.
>
> **Do not** use transitions:
> - At the very start of the script (no warmup needed before the first content scene).
> - Between two short, related scenes.
> - As a substitute for narration or content.
>
> When you pick a transition, choose from the enumerated `transitionId` catalog. The `primaryColor` and `speed` knobs exist for palette matching and pacing tweaks — prefer defaults. Set `holdSeconds` to roughly the transition's author-intended length (0.8–1.5s).

Plus the tool-schema constraint: `transitionId` is a strict enum; the model cannot invent names. This mirrors how template names are locked down today.

---

## 6. Budget enforcement

Two layers:

1. **Prompt-side (soft):** the system-prompt paragraph above.
2. **Validation-side (hard):** `produceScript()` post-processes the returned script, counts `scenes.filter(s => s.template === "transition-lottie").length`, and if it exceeds 3, emits a `ProducerError` with code `TOO_MANY_TRANSITIONS`. Fail-loud for now — we'd rather catch prompt drift early than silently clip.

---

## 7. Authoring workflow

### 7a. Primary path — Lottie Creator (recommended)

1. **Start from the lottiefiles.com library** when possible. Free-tier CC0 transitions are plentiful; fork one that's 80% there rather than authoring from scratch.
2. Open it in **Lottie Creator** (browser-based, no install).
3. Resize the composition to **1920×1080** (fullscreen) or **512×512** (center stinger). Adjust layer layout to taste.
4. Trim the timeline to ≤ 1.5s at 30 fps.
5. Rename the primary accent fill layer to `primary` in the Layers panel if you want runtime color override.
6. **Export → Lottie JSON** → save as `{transitionId}.json`.
7. Drop the file into `apps/player/public/transitions/`.

### 7b. Fallback path — After Effects + Bodymovin

1. Create a comp at the target size. Author the motion.
2. Ensure no expressions, no raster footage, no system fonts (convert text to shapes).
3. `Window → Extensions → Bodymovin`. Select the comp. In settings, disable "Glyphs" / "Images" / "Hidden"; enable "Standalone" if you want a fully self-contained file.
4. Render to JSON. Save as `{transitionId}.json`.
5. Drop into `apps/player/public/transitions/`.

### 7c. Committing a new transition to the catalog

Every transition addition is a three-file change, committed together:

1. The `.json` file in `apps/player/public/transitions/`.
2. The `TransitionId` enum in the shared types (wherever the scene union lives).
3. The same enum in the producer tool schema, plus a one-line entry in `PRODUCER_SYSTEM_PROMPT`'s transition catalog (name, mood, recommended placement).

If any of these three are out of sync, Agent 2 can reference a transition that doesn't exist on disk — so CI should lint that the enum and the `transitions/` directory match.

---

## 8. Starter catalog (suggested)

Ship small. Each file is expected at 5–25 KB.

| `transitionId` | Mood | Recommended use | Source |
|---|---|---|---|
| `wipe-horizontal` | Neutral, fast | Section boundaries | lottiefiles.com free tier — many options |
| `wipe-diagonal` | Dynamic | Subsystem pivots | lottiefiles.com |
| `dot-dissolve` | Calm, modern | Architecture → Quality handoff | Author in Creator |
| `iris-close` / `iris-open` | Cinematic pair | Wrap + reveal (use together) | Author as a pair |
| `stinger-bolt` | Energetic | Scorecard reveal | lottiefiles.com |
| `stinger-pop` | Playful | `character` / `friendly` personas | lottiefiles.com |
| `morph-shapes` | Geometric, modern | Architecture section opener | Author in Creator |
| `line-sweep` | Minimal, technical | `corporate` / `stern` personas | Author in Creator |

Pick **2–3** to start. Validate in a real script. Expand from there.

---

## 9. Bundle-size and preload notes

- **`lottie-web` canvas build:** ~60 KB min+gz. One-time cost. Ship it only on routes that actually render scripts.
- **Per-transition:** 5–25 KB JSON each. If the catalog grows past ~5, preload all referenced `.json` files at script-start (a parallel `fetch` for each `transitionId` that appears in `script.scenes`) so first-play doesn't stutter on slow connections.
- **Caching:** the in-memory `cache` Map in the player keeps parsed JSON in memory for the session. For cross-session caching, the files are static assets — let the HTTP layer handle it with long `Cache-Control: immutable` headers, versioned by file hash.

---

## 10. Migration from the sprite draft

For anyone with the earlier `TRANSITION-SPRITE-TEMPLATE.md` in hand, the deltas are:

| Concept | Sprite draft | Lottie (this doc) |
|---|---|---|
| Authoring tool | Aseprite | Lottie Creator (primary), AE + Bodymovin (fallback) |
| Asset format | `{id}.png` + `{id}.json` (Aseprite meta) | `{id}.json` (Lottie) only |
| Asset aesthetic | Raster / pixel-art | Vector (matches existing templates) |
| Runtime | Custom ~50-line canvas sprite player | `lottie-web` canvas build |
| Template name | `transition-sprite` | `transition-lottie` |
| Color override | `tint` (multiply blend over whole frame) | `primaryColor` (targeted layer rename) |
| Scales to stage | Letterbox-fit manual math | `preserveAspectRatio` via rendererSettings |
| New runtime dep | None | `lottie-web` (~60 KB canvas build) |

Everything else — the 1–3 cap, fail-loud validation, prompt guidance, three-file commit discipline — carries over unchanged.

---

## 11. Open questions

1. **Persona-aware filtering.** Should some transitions be off-limits for some personas (e.g., `stinger-pop` feels wrong for `stern`)? Could ship as an `allowedPersonas` field on each catalog entry and filter in the producer prompt. Defer until we have real scripts to judge from.
2. **Audio.** All transitions are silent today. If we later want stingers with SFX, add a parallel `sfx` slot and route through the existing voice player's audio graph — out of scope for v1.
3. **Palette theming.** If we introduce global palette themes per persona, `primaryColor` could auto-fill from the active palette instead of Agent 2 setting it explicitly. Keep manual for now — lets the model be deliberate.
4. **Canvas renderer feature gaps.** If we hit a transition that looks right in Creator but wrong in our runtime, either simplify the source or — worst case — ship a small SVG-renderer fallback for that specific transition. Flag this if/when it happens; don't pre-optimize.
