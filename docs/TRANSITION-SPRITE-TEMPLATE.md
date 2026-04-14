# `transition-sprite` — Template Contract

Sprite-sheet-driven scene transitions for the showboxes Script Player. Authored in Aseprite, played on the existing 2D canvas via a small playback helper. Intended as an **intermittent** visual variation tool: the Producer/Director (Agent 2) is instructed to use 1–3 per script, no more.

Companion to [ARCHITECTURE.md](./ARCHITECTURE.md). See also the visual primitive catalog in `PRODUCER_SYSTEM_PROMPT` (`apps/server/lib/agents/producer.system-prompt.ts`).

---

## 1. Purpose and constraints

**What this template is for:** giving long-running, detail-heavy presentations occasional kinetic breaks. A quick 6–20 frame sprite animation that plays between scenes (or at the top of a scene as an establishing beat) so the viewer's eye gets a visual "reset."

**What it is not:** a narrator of content. Transitions carry no narration and no informational payload. If a scene needs to explain something, use a content template (`title-bullets`, `code-zoom`, etc.), not this.

**Hard limits:**
- Max **3 transitions per script**, enforced at the producer prompt level.
- Duration capped at **1.5 seconds** of actual animation. Any "hold" after the animation is the next scene's responsibility.
- No narration, no voice — transitions are silent. (Voice continues seamlessly from the previous scene if mid-narration, or pauses cleanly.)
- Sprite sheet assets ship from a curated catalog. Agent 2 **cannot invent** transition names — the catalog is enumerated in the tool schema.

---

## 2. Slot schema

```typescript
interface TransitionSpriteScene {
  template: "transition-sprite";
  content: {
    /**
     * Which transition to play. Enumerated in the tool schema — the model
     * picks from the catalog, it cannot invent names.
     */
    transitionId: TransitionId;

    /**
     * Playback speed multiplier. 1.0 = author-intended fps from the
     * sprite-sheet metadata. Range 0.5–2.0. Default 1.0.
     */
    speed?: number;

    /**
     * Optional tint color (hex, e.g. "#22c55e"). Applied as a multiply
     * blend on top of the sprite for palette matching. Default none.
     */
    tint?: string;

    /**
     * Positioning on stage. Default "fullscreen".
     * - "fullscreen": scales to cover the stage (letterboxed if needed).
     * - "center": drawn at native size, centered.
     */
    placement?: "fullscreen" | "center";
  };

  /**
   * holdSeconds is the total scene duration. For transitions, this is
   * typically the animation duration + a very short pad (100–200ms).
   * The runtime clamps this to [animationDuration, 2.0].
   */
  holdSeconds: number;

  /**
   * No beats for transitions. Schema allows the field but it's ignored
   * by the renderer — flagged as a lint warning if present.
   */
  beats?: never;

  /**
   * No narration for transitions.
   */
  narration?: "";
}

type TransitionId =
  | "wipe-horizontal"
  | "wipe-diagonal"
  | "pixel-dissolve"
  | "crt-flicker"
  | "iris-close"
  | "iris-open"
  | "stinger-bolt"
  | "stinger-pop"
  | "static-snow";
// (Starter catalog — expand as assets are authored.)
```

---

## 3. Sprite sheet asset contract

Each `TransitionId` maps to a pair of files in `apps/player/public/transitions/`:

```
{transitionId}.png        # the sprite sheet (horizontal strip or grid)
{transitionId}.json       # Aseprite-exported metadata
```

### 3a. PNG layout

- Horizontal strip preferred (single row, N frames left-to-right). Grid layout supported if Aseprite's metadata matches.
- Power-of-two dimensions not required (canvas 2D is fine either way).
- Recommended frame size: **960×540** for fullscreen transitions (scales to stage), **256×256** for center stingers.
- Transparent background (alpha channel). No baked-in letterbox.
- Keep total strip width **≤ 4096 px** to stay inside texture limits if we ever switch to WebGL.

### 3b. Aseprite JSON metadata

Export via **File → Export Sprite Sheet** with these options:

- Output: PNG + JSON Data
- JSON format: **Array** (not Hash — our loader assumes array order matches strip order)
- Meta: **Frame Tags**, **Layers** (optional), **Slices** (optional)

The loader reads only `frames[]` and `meta.frameTags[]`. Example:

```json
{
  "frames": [
    { "frame": { "x": 0,   "y": 0, "w": 960, "h": 540 }, "duration": 50 },
    { "frame": { "x": 960, "y": 0, "w": 960, "h": 540 }, "duration": 50 },
    { "frame": { "x": 1920,"y": 0, "w": 960, "h": 540 }, "duration": 60 }
  ],
  "meta": {
    "frameTags": [
      { "name": "play", "from": 0, "to": 2, "direction": "forward" }
    ],
    "size": { "w": 2880, "h": 540 }
  }
}
```

**Tag conventions:**
- Tag named `play` is the default/only sequence the runtime plays. If absent, the runtime plays all frames 0..N-1 in order.
- Reserve tag name `loop` for transitions that should repeat until a duration is met (rare — prefer baked-in length).

---

## 4. Runtime — the ~50-line sprite-sheet player

Lives at `apps/player/src/primitives/transitionSprite.ts`. Pseudocode shape:

```typescript
type TransitionManifest = {
  image: HTMLImageElement;
  frames: Array<{ x: number; y: number; w: number; h: number; duration: number }>;
  tag: { from: number; to: number } | null;
};

async function loadTransition(id: TransitionId): Promise<TransitionManifest> {
  const [image, meta] = await Promise.all([
    loadImage(`/transitions/${id}.png`),
    fetch(`/transitions/${id}.json`).then(r => r.json()),
  ]);
  const playTag = meta.meta.frameTags?.find(t => t.name === "play") ?? null;
  return {
    image,
    frames: meta.frames.map(f => ({ ...f.frame, duration: f.duration })),
    tag: playTag ? { from: playTag.from, to: playTag.to } : null,
  };
}

export async function playTransition(
  ctx: CanvasRenderingContext2D,
  id: TransitionId,
  opts: { speed?: number; tint?: string; placement?: "fullscreen" | "center" } = {}
): Promise<void> {
  const manifest = await loadTransition(id);
  const speed = opts.speed ?? 1.0;
  const [from, to] = manifest.tag
    ? [manifest.tag.from, manifest.tag.to]
    : [0, manifest.frames.length - 1];

  const stageW = ctx.canvas.width;
  const stageH = ctx.canvas.height;

  return new Promise(resolve => {
    let i = from;
    let frameStart = performance.now();

    const tick = (now: number) => {
      const frame = manifest.frames[i];
      const elapsed = now - frameStart;
      const dur = frame.duration / speed;

      // Clear + draw current frame
      ctx.clearRect(0, 0, stageW, stageH);
      if (opts.placement === "center") {
        const dx = (stageW - frame.w) / 2;
        const dy = (stageH - frame.h) / 2;
        ctx.drawImage(manifest.image, frame.x, frame.y, frame.w, frame.h, dx, dy, frame.w, frame.h);
      } else {
        // fullscreen — letterbox-fit
        const scale = Math.min(stageW / frame.w, stageH / frame.h);
        const dw = frame.w * scale;
        const dh = frame.h * scale;
        const dx = (stageW - dw) / 2;
        const dy = (stageH - dh) / 2;
        ctx.drawImage(manifest.image, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
      }

      if (opts.tint) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = opts.tint;
        ctx.fillRect(0, 0, stageW, stageH);
        ctx.restore();
      }

      if (elapsed >= dur) {
        if (i >= to) {
          resolve();
          return;
        }
        i++;
        frameStart = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
```

Integration in the Presenter's scene loop:

```typescript
case "transition-sprite":
  await playTransition(ctx, scene.content.transitionId, {
    speed: scene.content.speed,
    tint: scene.content.tint,
    placement: scene.content.placement,
  });
  // transitions don't schedule beats and don't speak; ScriptPlayer
  // still honors holdSeconds but in practice playTransition returns
  // close to holdSeconds already.
  break;
```

---

## 5. Agent 2 guidance (producer prompt additions)

Add to `PRODUCER_SYSTEM_PROMPT`:

> **Transitions (`transition-sprite`).** You have access to a small catalog of sprite-based transitions for visual variation in long presentations. Use them **sparingly**: **1–3 per script, never more**. They carry no narration and no information — their only job is to give the viewer a kinetic break between dense content scenes. Good placements:
> - After a heavy `code-zoom` run, before shifting to a new subsystem.
> - Between major analysis sections (e.g. architecture → code quality).
> - At the top of the final section as a "stinger."
>
> **Do not** use transitions:
> - At the very start of the script (no warmup needed before the first content scene).
> - Between two short, related scenes.
> - As a substitute for narration or content.
>
> When you pick a transition, choose from the enumerated `transitionId` catalog. The `tint` and `speed` knobs exist for minor tuning — prefer defaults. Set `holdSeconds` to roughly the transition's author-intended length (0.8–1.5s).

Plus the tool-schema constraint: `transitionId` is a strict enum; the model cannot invent names. This mirrors how template names are locked down today.

---

## 6. Budget enforcement

Two layers:

1. **Prompt-side (soft):** the system-prompt paragraph above.
2. **Validation-side (hard):** `produceScript()` post-processes the returned script, counts `scenes.filter(s => s.template === "transition-sprite").length`, and if it exceeds 3, emits a `ProducerError` with code `TOO_MANY_TRANSITIONS`. The client can either retry once with a reminder injected or fail loudly — recommend fail-loud for now so we catch prompt drift early.

---

## 7. Authoring workflow (Aseprite → catalog)

1. Open Aseprite, new sprite 960×540 (fullscreen) or 256×256 (center stinger). Transparent background.
2. Animate over 6–20 frames. Keep frame durations in Aseprite's Timeline — the exporter writes them to JSON.
3. Tag the full sequence as `play` (Timeline → right-click → New Tag).
4. `File → Export Sprite Sheet`:
   - Layout: **Horizontal strip**
   - Output File: `{transitionId}.png`
   - JSON Data: on, **Array** format, filename `{transitionId}.json`
   - Meta: **Frame Tags** checked.
5. Drop both files into `apps/player/public/transitions/`.
6. Add `"{transitionId}"` to the `TransitionId` enum in the shared types and to the producer tool-schema enum. Add a one-line description to the producer system prompt's transition catalog (name, mood, recommended placement).
7. Commit assets + schema changes together so the model can never select a transition that doesn't exist on disk.

---

## 8. Starter catalog (suggested)

Ship small. Each entry is ~2–8 KB PNG.

| `transitionId` | Mood | Frames | Recommended use |
|---|---|---|---|
| `wipe-horizontal` | Neutral, fast | 8 | Section boundaries |
| `wipe-diagonal` | Dynamic | 10 | Subsystem pivots |
| `pixel-dissolve` | Retro, calm | 12 | Architecture → Quality handoff |
| `iris-close` / `iris-open` | Cinematic pair | 8 / 8 | Wrap + reveal |
| `crt-flicker` | Retro-tech stinger | 6 | Before a `code-zoom` |
| `stinger-bolt` | Energetic | 10 | Scorecard reveal |
| `stinger-pop` | Playful | 8 | Character/friendly personas |
| `static-snow` | Unsettling / stern | 14 | Security finding emphasis |

Start with 2–3 of these, validate in a real script, expand from there.

---

## 9. Open questions

1. **Persona-aware filtering.** Should some transitions be off-limits for some personas (e.g., `static-snow` feels wrong for `friendly`)? Could ship as a `allowedPersonas` field on each catalog entry and filter in the producer prompt. Defer until we have real scripts to judge from.
2. **Audio.** All transitions are silent today. If we later want stingers with SFX, wire a parallel `sfx` slot and stream through the existing voice player's audio graph — out of scope for v1.
3. **Preload strategy.** If a script has transitions, preload all referenced sprite sheets at script-start so the first play doesn't stutter on slow connections. Easy win; add when the catalog grows past ~5.
