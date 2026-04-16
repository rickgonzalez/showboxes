# Scene Transitions

This doc explains how the player animates between scenes, why it's built the way it is, and how to add or modify a transition effect.

---

## TL;DR

A `PresentationScript` already emits a `TransitionSpec` per scene (and a default on the script). The `ScriptPlayer` reads that spec at each scene handoff and runs two DOM animations — one to slide/fade the old scene out, one to bring the new scene in — on a single wrapper element that contains every render layer (canvas + DOM + 3D).

```
narration end → transitionOut(spec) → teardown+clear → present(next) → transitionIn(spec) → narration start
```

The spec lives on the **incoming** scene. Both halves of the handoff use the same spec.

---

## The shape of a transition

Defined in [src/player/types.ts](src/player/types.ts):

```typescript
export interface TransitionSpec {
  type: 'cut' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'dissolve';
  durationMs: number;
}
```

On a scene:

```typescript
{
  id: 'intro',
  transition: { type: 'fade', durationMs: 600 },
  narration: '...',
  holdSeconds: 3,
  primitive: { template: 'title-bullets', content: { ... } },
}
```

If a scene omits `transition`, the player falls back to `script.defaults.transition`.

---

## Where transitions run: the stageRoot

The single most important design choice: **all three render layers transition together, on one parent element.**

The player has three sibling layers — a WebGL-ish 3D host, an HTML DOM layer, and a 2D canvas — all absolutely positioned inside a `.sb-presentation` wrapper ([src/react/Presentation.tsx](src/react/Presentation.tsx)):

```html
<div class="sb-presentation" ref={stageRootRef}>
  <div class="sb-stage3d-host" ref={stage3dHostRef} />
  <div class="sb-dom-layer"    ref={domRootRef} />
  <canvas class="sb-canvas-layer" ref={canvasRef} />
</div>
```

If you animate each layer independently you get a flash at the handoff — the canvas leads or lags the DOM by a frame or two and the eye picks it up. Animating the shared wrapper moves them as one unit.

The `Presenter` exposes that wrapper as `stageRoot` so orchestrators can reach it ([src/service/presenter.ts](src/service/presenter.ts)):

```typescript
export class Presenter {
  readonly stage: Stage;
  readonly domRoot: HTMLElement;
  readonly stageRoot: HTMLElement;    // ← the transition target
  // ...

  constructor(
    canvas: HTMLCanvasElement,
    domRoot: HTMLElement,
    stage3dHost?: HTMLElement,
    stageRoot?: HTMLElement,
  ) {
    this.stage = new Stage(canvas);
    this.domRoot = domRoot;
    this.stage3dHost = stage3dHost ?? null;
    this.stageRoot = stageRoot ?? domRoot.parentElement ?? domRoot;
  }
}
```

Note the fallback: if a host doesn't pass an explicit `stageRoot`, we use `domRoot.parentElement`. Existing call sites keep working without changes.

---

## The two animation helpers

Both live as private methods on `ScriptPlayer` ([src/player/ScriptPlayer.ts](src/player/ScriptPlayer.ts)). They're plain CSS transitions — no anime.js, no rAF loop. Scene handoffs happen on the order of seconds, so the overhead of a real animation engine is unnecessary; inline `style.transition` does the job.

### `transitionOut`

Drives the outgoing scene away. The caller `await`s its duration before tearing down the old template.

```typescript
private async transitionOut(spec: TransitionSpec): Promise<void> {
  if (spec.type === 'cut') return;
  const root = this.presenter.stageRoot;
  root.style.transition = `opacity ${spec.durationMs}ms ease, transform ${spec.durationMs}ms ease`;
  switch (spec.type) {
    case 'fade':
    case 'dissolve':
      root.style.opacity = '0';
      break;
    case 'slide-left':
      root.style.transform = 'translateX(-100%)';
      break;
    case 'slide-right':
      root.style.transform = 'translateX(100%)';
      break;
    case 'zoom-in':
      root.style.transform = 'scale(1.08)';
      root.style.opacity = '0';
      break;
  }
  await this.wait(spec.durationMs);
}
```

### `transitionIn`

Snaps the new scene into its entry state with `transition: none` (otherwise the browser would animate from whatever it is now — often `none`/neutral — straight past the entry state), forces a reflow so the browser commits that state, waits one frame, then swaps the CSS transition back on and releases to neutral.

```typescript
private async transitionIn(spec: TransitionSpec): Promise<void> {
  if (spec.type === 'cut') return;
  const root = this.presenter.stageRoot;
  root.style.transition = 'none';
  switch (spec.type) {
    case 'fade':
    case 'dissolve':
      root.style.opacity = '0';
      root.style.transform = 'none';
      break;
    case 'slide-left':
      root.style.transform = 'translateX(100%)';
      root.style.opacity = '1';
      break;
    case 'slide-right':
      root.style.transform = 'translateX(-100%)';
      root.style.opacity = '1';
      break;
    case 'zoom-in':
      root.style.transform = 'scale(0.92)';
      root.style.opacity = '0';
      break;
  }
  // Force a reflow so the browser registers the entry state before we
  // swap transitions back on.
  void root.offsetHeight;
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  root.style.transition = `opacity ${spec.durationMs}ms ease, transform ${spec.durationMs}ms ease`;
  root.style.opacity = '1';
  root.style.transform = 'none';
  await this.wait(spec.durationMs);
  // Clear inline styles so they don't interfere with future transitions
  // or any CSS the app might apply.
  root.style.transition = '';
  root.style.opacity = '';
  root.style.transform = '';
}

private wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
```

**Why the reflow + rAF?** Without it, the browser can coalesce the style changes and animate straight from the pre-snap state to neutral — you see no entry animation at all. Reading `root.offsetHeight` forces layout, committing the snap styles. Then one `requestAnimationFrame` gives the browser a tick to paint before the next style mutation kicks off the actual animation.

**Why clear styles at the end?** The inline `transition`, `opacity`, and `transform` would otherwise linger on the wrapper and interfere with later CSS or the next handoff (the next `transitionOut` would start a transition from `transition: none` to the fade, which briefly re-animates back from the neutral state).

---

## Wiring it into the scene lifecycle

The handoff lives in `enterScene`. The relevant excerpt:

```typescript
private async enterScene(index: number): Promise<void> {
  const scene = this.script.scenes[index];
  if (!scene) { this.end(); return; }

  // Incoming scene's transition governs both halves of the handoff.
  const spec = scene.transition ?? this.script.defaults.transition;
  const isFirstScene = this.currentHandle === null;
  const epochBeforeOut = this.sceneEpoch;

  if (!isFirstScene) {
    await this.transitionOut(spec);
    // If a teardown/seek/stop happened during the out-transition, abort.
    if (this.sceneEpoch !== epochBeforeOut) return;
  }

  this.teardownScene();       // increments sceneEpoch, dismisses old handle
  this.presenter.clear();     // clears canvas, DOM, 3D
  this.sceneIndex = index;
  const epochThisScene = this.sceneEpoch;

  this.currentHandle = this.presenter.present(scene.primitive);
  this.events.onSceneEnter?.(scene, index);

  if (!isFirstScene) {
    await this.transitionIn(spec);
    if (this.sceneEpoch !== epochThisScene) return;
  }

  // ...start narration, schedule beats, schedule advance...
}
```

Call sites that kick off `enterScene` are fire-and-forget and use `void` to signal that explicitly:

```typescript
void this.enterScene(this.sceneIndex + 1);
```

---

## Design decisions (and the reasoning behind them)

### 1. Incoming scene's spec drives both halves

Scripts read like prose: "this scene enters with a fade." Making the incoming transition govern *both* the out and the in matches that mental model and means the author only has to annotate one scene, not two. The alternative — outgoing spec for the out, incoming for the in — doubles the author's workload and produces weirder boundaries (e.g. slide-left exit into a fade-in).

### 2. Transition duration adds to inter-scene dead air

The order is strictly serial: `narration end → hold → out (durationMs) → teardown+clear → mount → in (durationMs) → next narration`. A `fade/600ms` handoff adds about 1.2s of silence between narrations; a `cut/200ms` handoff adds ~0ms because both helpers are no-ops for `cut`.

The alternative was to *overlap* the out-transition with the tail of the hold floor — tighter pacing but much more complex state tracking, and the Producer already tunes `holdSeconds` and `durationMs` independently. If something feels laggy the fix is to lower `durationMs` in the script, not to add overlap logic. Ship simple, revisit only if the Producer can't make it feel right.

### 3. Skip the out-transition on the first scene

There is nothing to transition out of at `t=0`. `isFirstScene` is detected by `this.currentHandle === null` (no template is mounted before the first scene). The in-transition still runs on the first scene ... actually, it doesn't: the same `isFirstScene` flag also gates the in-transition, so scene 0 comes up instantly. That keeps the very first frame of a presentation from being a fade-from-black, which feels sluggish when a user hits play.

If you want a fade-in on scene 0, move the `transitionIn` call outside the `isFirstScene` guard. The out guard should stay — there's genuinely nothing to animate away.

### 4. `teardownScene()` stays synchronous

Even though `enterScene` is now async, teardown is not. Two reasons:

- **`stop()` must be instant.** When the user hits stop, the stage should clear on the next frame, not wait out a fade. `stop()` bypasses `enterScene` and calls `teardownScene()` + `presenter.clear()` directly.
- **Epoch guarding is simpler when teardown is synchronous.** The `sceneEpoch` counter increments inside `teardownScene()`; the async gaps in `enterScene` check it before and after each `await` to detect interruptions (pause, seek, stop). If teardown itself yielded, those checks would get much messier.

### 5. `presenter.clear()` has to run between scenes

The old stub used to call `presenter.clear()` inside `applyTransition` — it cleared the canvas, DOM, and 3D layer. The new helpers only animate; they don't clear. The handle's `dismiss()` only removes its own DOM nodes, not canvas TextBoxes or 3D scene objects from sibling templates. So `enterScene` explicitly calls `this.presenter.clear()` after `teardownScene()` to make sure nothing from the previous scene leaks onto the next one's canvas or 3D layer.

### 6. Epoch checks after every `await`

Any `await` in `enterScene` is a window where the user can pause, seek, or stop. If that happens, continuing to mount the next scene's narration and timers would be a bug. Every `await` is followed by:

```typescript
if (this.sceneEpoch !== epochAtStart) return;
```

which bails out cleanly if the scene we started with is no longer the live one.

### 7. `dissolve` aliases to `fade` for now

The type includes `dissolve` but the user-facing difference from `fade` is subtle (slower easing curve, sometimes a slight blur). Today both do the same thing. When we want a real distinction, `dissolve` is the right place to add a longer-duration ease or a CSS filter blur.

### 8. `zoom-in` entry transform

The user's original sketch only covered the exit state for `zoom-in` (`scale(1.08)`). For the entry we mirror: `scale(0.92)`. The new scene starts slightly small and grows into place while fading up — it feels like the camera pushing in, which matches the name.

---

## Adding a new transition type

Four steps:

1. **Extend the union** in [src/player/types.ts](src/player/types.ts):

   ```typescript
   export interface TransitionSpec {
     type: 'cut' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'dissolve' | 'slide-up';
     durationMs: number;
   }
   ```

2. **Add the exit state** to `transitionOut`:

   ```typescript
   case 'slide-up':
     root.style.transform = 'translateY(-100%)';
     break;
   ```

3. **Add the entry state** to `transitionIn`. This is where the new scene *starts from*, before animating to neutral:

   ```typescript
   case 'slide-up':
     root.style.transform = 'translateY(100%)';
     root.style.opacity = '1';
     break;
   ```

4. **Teach the Producer** to emit it (outside the scope of this doc — wherever scripts are generated, add the new `type` value to any schema / enum / prompt).

If your new transition needs opacity *and* transform, set both in each state. If it needs something the current `transition` property doesn't cover (e.g. `filter: blur()`), add that property to the transition string in both helpers:

```typescript
root.style.transition = `opacity ${d}ms ease, transform ${d}ms ease, filter ${d}ms ease`;
```

---

## Testing checklist

- [ ] Typecheck passes (`tsc -b --noEmit` in `apps/player`).
- [ ] Friendly script (fade/600ms): scene boundaries crossfade smoothly, no flash where canvas outruns DOM.
- [ ] Stern script (cut/200ms): scene boundaries cut instantly. No inline styles linger on `.sb-presentation` between scenes.
- [ ] Pause mid-scene, resume: no transition fires on resume. (`resumeScene` never calls `enterScene`.)
- [ ] Stop mid-transition: stage clears immediately without waiting for the animation.
- [ ] Seek to another scene: transitions back out of the current one and into the target.
- [ ] First scene: no fade-in, no fade-out — mounts instantly on play.
- [ ] Emphasize beat at `at: 0`: pulse animation runs on top of (or concurrent with) the in-transition. Both visible; neither clobbers the other.

---

## Files touched to build this feature

- [src/service/presenter.ts](src/service/presenter.ts) — added the `stageRoot` field and a constructor arg that defaults to `domRoot.parentElement`.
- [src/react/Presentation.tsx](src/react/Presentation.tsx) — attached a ref to the `.sb-presentation` wrapper and passed it to `Presenter`.
- [src/player/ScriptPlayer.ts](src/player/ScriptPlayer.ts) — replaced the `applyTransition` stub with real `transitionOut` / `transitionIn`; made `enterScene` async; guarded every `await` with an epoch check; marked all `enterScene` call sites with `void`.
