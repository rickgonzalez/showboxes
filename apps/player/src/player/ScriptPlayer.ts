import type { Presenter } from '../service/presenter';
import type { TemplateHandle } from '../templates';
import type { Beat, PresentationScript, Scene, TransitionSpec } from './types';
import type { VoicePlayer } from './VoicePlayer';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'ended';

export interface ProgressInfo {
  sceneIndex: number;
  sceneId: string | null;
  total: number;
  elapsedMs: number;
  sceneDurationMs: number;
  state: PlayerState;
}

export interface ScriptPlayerEvents {
  onSceneEnter?: (scene: Scene, index: number) => void;
  onSceneExit?: (scene: Scene, index: number) => void;
  onStateChange?: (state: PlayerState) => void;
  onEnd?: () => void;
}

/**
 * Reads a PresentationScript and drives the Presenter scene-by-scene.
 * Pure orchestration — doesn't know about templates or voice internals.
 *
 * Intentionally loose: this is Phase 1, optimized for dialing in feel.
 * We lean on setTimeout (not rAF) because scene cadence is seconds-scale
 * and we want simple pause/resume semantics.
 */
export class ScriptPlayer {
  private script: PresentationScript;
  private presenter: Presenter;
  private voice: VoicePlayer;
  private events: ScriptPlayerEvents;

  private sceneIndex = 0;
  private _state: PlayerState = 'idle';
  private currentHandle: TemplateHandle | null = null;

  private sceneTimer: number | null = null;
  private beatTimers: number[] = [];

  /** For progress reporting / pause accounting. */
  private sceneStartedAt = 0;
  private sceneDurationMs = 0;
  private pauseOffsetMs = 0;
  /** Snapshot of beats not yet fired, with their absolute remaining ms. */
  private pendingBeats: Array<{ beat: Beat; remainingMs: number }> = [];

  /**
   * Incremented every time a scene is entered or torn down. Promise-driven
   * advance (Web Speech path) captures this at scene start and only fires
   * if it still matches — guards against a late onend from a cancelled scene.
   */
  private sceneEpoch = 0;
  /**
   * For accurate-duration voices, advance is a single setTimeout we can
   * clear on pause/seek. For Web Speech it's a promise+floor timer pair.
   */
  private advanceMode: 'timer' | 'promise' = 'timer';
  private narrationDoneAt = 0;
  private holdFloorMs = 0;
  private narrationSettled = false;

  constructor(
    script: PresentationScript,
    presenter: Presenter,
    voice: VoicePlayer,
    events: ScriptPlayerEvents = {}
  ) {
    this.script = script;
    this.presenter = presenter;
    this.voice = voice;
    this.events = events;
  }

  get state(): PlayerState {
    return this._state;
  }

  get progress(): ProgressInfo {
    const scene = this.script.scenes[this.sceneIndex] ?? null;
    const elapsed =
      this._state === 'paused'
        ? this.pauseOffsetMs
        : this._state === 'playing'
          ? performance.now() - this.sceneStartedAt + this.pauseOffsetMs
          : 0;
    return {
      sceneIndex: this.sceneIndex,
      sceneId: scene?.id ?? null,
      total: this.script.scenes.length,
      elapsedMs: elapsed,
      sceneDurationMs: this.sceneDurationMs,
      state: this._state,
    };
  }

  /** Start (or resume) playback. */
  play(): void {
    if (this._state === 'playing') return;
    if (this._state === 'paused') {
      this.resumeScene();
      return;
    }
    if (this._state === 'ended') {
      this.sceneIndex = 0;
    }
    this.enterScene(this.sceneIndex);
  }

  pause(): void {
    if (this._state !== 'playing') return;
    if (this.sceneTimer !== null) {
      window.clearTimeout(this.sceneTimer);
      this.sceneTimer = null;
    }
    for (const id of this.beatTimers) window.clearTimeout(id);
    this.beatTimers = [];

    this.pauseOffsetMs += performance.now() - this.sceneStartedAt;

    // Re-snapshot remaining beats relative to pauseOffset.
    this.pendingBeats = this.pendingBeats
      .filter((p) => {
        const beatAt = p.beat.at * 1000;
        return beatAt > this.pauseOffsetMs;
      })
      .map((p) => ({ beat: p.beat, remainingMs: p.beat.at * 1000 - this.pauseOffsetMs }));

    this.voice.pause();
    this.setState('paused');
  }

  /** Jump to a scene by index or id. Keeps current play/pause state. */
  seek(target: number | string): void {
    const idx =
      typeof target === 'number'
        ? target
        : this.script.scenes.findIndex((s) => s.id === target);
    if (idx < 0 || idx >= this.script.scenes.length) return;

    const wasPlaying = this._state === 'playing' || this._state === 'paused';
    this.teardownScene();
    this.sceneIndex = idx;
    if (wasPlaying) {
      this.enterScene(idx);
    } else {
      // Idle seek — render the scene but don't start timers. Useful for
      // manually stepping through scenes while tuning.
      this.renderSceneOnly(this.script.scenes[idx]);
    }
  }

  next(): void {
    if (this.sceneIndex >= this.script.scenes.length - 1) {
      this.end();
      return;
    }
    this.seek(this.sceneIndex + 1);
  }

  prev(): void {
    if (this.sceneIndex <= 0) return;
    this.seek(this.sceneIndex - 1);
  }

  /** Stop playback entirely and clear the stage. */
  stop(): void {
    this.teardownScene();
    this.presenter.clear();
    this.sceneIndex = 0;
    this.setState('idle');
  }

  // --- internals ---

  private enterScene(index: number): void {
    const scene = this.script.scenes[index];
    if (!scene) {
      this.end();
      return;
    }

    this.teardownScene();
    this.sceneIndex = index;

    this.applyTransition(scene.transition ?? this.script.defaults.transition);
    this.currentHandle = this.presenter.present(scene.primitive);
    this.events.onSceneEnter?.(scene, index);

    const narration = this.voice.speak(scene.narration, {
      speed: this.script.defaults.voice.speed,
    });
    const narrationMs = narration.durationMs;
    const holdMs = scene.holdSeconds * 1000;

    this.pauseOffsetMs = 0;
    this.sceneStartedAt = performance.now();
    this.narrationSettled = false;
    this.holdFloorMs = holdMs;

    this.pendingBeats =
      scene.beats?.map((b) => ({ beat: b, remainingMs: b.at * 1000 })) ?? [];

    this.scheduleBeats();

    const epoch = ++this.sceneEpoch;
    if (narration.hasAccurateDuration) {
      // Stub / pre-generated audio: durationMs is truth. Single timer drives
      // advance; producer's holdSeconds acts as a minimum floor.
      this.advanceMode = 'timer';
      this.sceneDurationMs = Math.max(narrationMs, holdMs);
      this.scheduleAdvance(this.sceneDurationMs);
    } else {
      // Web Speech: durationMs is a forecast. Advance when audio actually
      // ends AND the hold floor has elapsed. Track a provisional duration
      // for progress reporting; it's refined when `done` resolves.
      this.advanceMode = 'promise';
      this.sceneDurationMs = Math.max(narrationMs, holdMs);
      narration.done.then(() => {
        if (this.sceneEpoch !== epoch) return;
        this.narrationSettled = true;
        this.narrationDoneAt = performance.now() - this.sceneStartedAt + this.pauseOffsetMs;
        // Update reported duration to reflect real audio end when it's longer
        // than our forecast so the progress bar doesn't overshoot.
        this.sceneDurationMs = Math.max(this.narrationDoneAt, holdMs);
        this.maybeAdvanceAfterNarration(epoch);
      });
      // The hold floor still needs its own timer in case audio finishes first.
      this.scheduleHoldFloor(holdMs, epoch);
    }
    this.setState('playing');
  }

  /**
   * Web Speech advance path: fires when BOTH the real audio has ended and
   * the producer's holdSeconds floor has elapsed.
   */
  private maybeAdvanceAfterNarration(epoch: number): void {
    if (this.sceneEpoch !== epoch) return;
    if (!this.narrationSettled) return;
    const elapsed = performance.now() - this.sceneStartedAt + this.pauseOffsetMs;
    const remainingFloor = this.holdFloorMs - elapsed;
    if (remainingFloor <= 0) {
      this.advanceNow();
    }
    // else: the hold-floor timer will fire advanceNow when it expires.
  }

  private scheduleHoldFloor(holdMs: number, epoch: number): void {
    const elapsed = performance.now() - this.sceneStartedAt + this.pauseOffsetMs;
    const remaining = Math.max(0, holdMs - elapsed);
    this.sceneTimer = window.setTimeout(() => {
      if (this.sceneEpoch !== epoch) return;
      if (this.narrationSettled) {
        this.advanceNow();
      }
      // else: narration still playing; `done` handler will advance when it settles.
    }, remaining);
  }

  private advanceNow(): void {
    this.events.onSceneExit?.(this.script.scenes[this.sceneIndex], this.sceneIndex);
    if (this.sceneIndex >= this.script.scenes.length - 1) {
      this.end();
    } else {
      this.enterScene(this.sceneIndex + 1);
    }
  }

  private resumeScene(): void {
    this.sceneStartedAt = performance.now();
    this.scheduleBeats();
    if (this.advanceMode === 'timer') {
      const remaining = this.sceneDurationMs - this.pauseOffsetMs;
      this.scheduleAdvance(Math.max(0, remaining));
    } else {
      // Promise path: if narration already ended during pause, only the hold
      // floor is left. Otherwise reschedule the floor; the original `done`
      // promise is still bound to the same epoch and will fire when speech
      // resumes and finishes.
      const epoch = this.sceneEpoch;
      if (this.narrationSettled) {
        const remainingFloor = this.holdFloorMs - this.pauseOffsetMs;
        if (remainingFloor <= 0) {
          this.advanceNow();
          return;
        }
        this.sceneTimer = window.setTimeout(() => {
          if (this.sceneEpoch !== epoch) return;
          this.advanceNow();
        }, remainingFloor);
      } else {
        this.scheduleHoldFloor(this.holdFloorMs, epoch);
      }
    }
    this.voice.resume();
    this.setState('playing');
  }

  private scheduleBeats(): void {
    for (const p of this.pendingBeats) {
      const id = window.setTimeout(() => this.fireBeat(p.beat), p.remainingMs);
      this.beatTimers.push(id);
    }
  }

  private scheduleAdvance(ms: number): void {
    this.sceneTimer = window.setTimeout(() => {
      this.events.onSceneExit?.(this.script.scenes[this.sceneIndex], this.sceneIndex);
      if (this.sceneIndex >= this.script.scenes.length - 1) {
        this.end();
      } else {
        this.enterScene(this.sceneIndex + 1);
      }
    }, ms);
  }

  private fireBeat(beat: Beat): void {
    const action = beat.action;
    switch (action.type) {
      case 'emphasize':
        this.currentHandle?.emphasize?.(action.target);
        break;
      case 'highlight-line':
        // Templates (e.g. code-zoom) accept a string target that encodes a line.
        this.currentHandle?.emphasize?.(String(action.line));
        break;
      case 'reveal':
      case 'annotate':
      case 'fx':
        // Phase 1: log-only. Wire these as the Producer starts emitting them.
        // eslint-disable-next-line no-console
        console.debug('[ScriptPlayer] beat not yet implemented', action);
        break;
    }
  }

  private applyTransition(_t: TransitionSpec): void {
    // Phase 1: rely on each template's own entrance animation.
    // Real transition orchestration (fade, slide, dissolve) lives in Phase 6.
    this.presenter.clear();
  }

  private renderSceneOnly(scene: Scene): void {
    this.presenter.clear();
    this.currentHandle = this.presenter.present(scene.primitive);
    this.events.onSceneEnter?.(scene, this.sceneIndex);
  }

  private teardownScene(): void {
    this.sceneEpoch++;
    if (this.sceneTimer !== null) {
      window.clearTimeout(this.sceneTimer);
      this.sceneTimer = null;
    }
    for (const id of this.beatTimers) window.clearTimeout(id);
    this.beatTimers = [];
    this.pendingBeats = [];
    this.narrationSettled = false;
    this.voice.stop();
    this.currentHandle?.dismiss();
    this.currentHandle = null;
  }

  private end(): void {
    this.teardownScene();
    this.setState('ended');
    this.events.onEnd?.();
  }

  private setState(s: PlayerState): void {
    if (this._state === s) return;
    this._state = s;
    this.events.onStateChange?.(s);
  }
}
