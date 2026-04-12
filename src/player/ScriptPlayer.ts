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
    this.sceneDurationMs = Math.max(narrationMs, holdMs);

    this.pauseOffsetMs = 0;
    this.sceneStartedAt = performance.now();

    this.pendingBeats =
      scene.beats?.map((b) => ({ beat: b, remainingMs: b.at * 1000 })) ?? [];

    this.scheduleBeats();
    this.scheduleAdvance(this.sceneDurationMs);
    this.setState('playing');
  }

  private resumeScene(): void {
    const remaining = this.sceneDurationMs - this.pauseOffsetMs;
    this.sceneStartedAt = performance.now();
    this.scheduleBeats();
    this.scheduleAdvance(Math.max(0, remaining));
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
    if (this.sceneTimer !== null) {
      window.clearTimeout(this.sceneTimer);
      this.sceneTimer = null;
    }
    for (const id of this.beatTimers) window.clearTimeout(id);
    this.beatTimers = [];
    this.pendingBeats = [];
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
