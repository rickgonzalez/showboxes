/**
 * VoicePlayer interface — a swappable narration surface.
 *
 * Phase 1 ships a StubVoicePlayer that reports a fake duration derived
 * from word count. Phase 1b will add a real TTS client (ElevenLabs
 * streaming or similar). The ScriptPlayer only depends on this interface.
 */

export interface SpeakHandle {
  /** Estimated total duration in ms. Available immediately for scheduling. */
  durationMs: number;
  /** Resolves when narration finishes (or is cancelled). */
  done: Promise<void>;
  /** Stops the narration early. Safe to call multiple times. */
  cancel(): void;
}

export interface VoicePlayer {
  /** Begin narrating `text`. Returns a handle with a known duration. */
  speak(text: string, opts?: { speed?: number }): SpeakHandle;
  /** Pause any in-flight narration. No-op if nothing is playing. */
  pause(): void;
  /** Resume paused narration. */
  resume(): void;
  /** Cancel any in-flight narration and reset. */
  stop(): void;
}

/**
 * StubVoicePlayer — no audio, just a timer.
 *
 * Duration heuristic: ~165 words/minute at speed 1.0 → ~364ms per word.
 * We bias a little slower (400ms) to simulate the padding real TTS tends
 * to add for punctuation.
 */
export class StubVoicePlayer implements VoicePlayer {
  private active: {
    handle: SpeakHandle;
    resolve: () => void;
    timer: number | null;
    remaining: number;
    startedAt: number;
    paused: boolean;
  } | null = null;

  speak(text: string, opts?: { speed?: number }): SpeakHandle {
    this.stop();

    const speed = opts?.speed ?? 1.0;
    const words = Math.max(1, text.trim().split(/\s+/).length);
    const durationMs = Math.round((words * 400) / speed);

    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));

    const handle: SpeakHandle = {
      durationMs,
      done,
      cancel: () => this.stop(),
    };

    const timer = window.setTimeout(() => {
      if (this.active?.handle === handle) {
        this.active.resolve();
        this.active = null;
      }
    }, durationMs);

    this.active = {
      handle,
      resolve: resolveDone,
      timer,
      remaining: durationMs,
      startedAt: performance.now(),
      paused: false,
    };

    return handle;
  }

  pause(): void {
    const a = this.active;
    if (!a || a.paused) return;
    if (a.timer !== null) {
      window.clearTimeout(a.timer);
      a.timer = null;
    }
    a.remaining = Math.max(0, a.remaining - (performance.now() - a.startedAt));
    a.paused = true;
  }

  resume(): void {
    const a = this.active;
    if (!a || !a.paused) return;
    a.startedAt = performance.now();
    a.paused = false;
    a.timer = window.setTimeout(() => {
      if (this.active === a) {
        a.resolve();
        this.active = null;
      }
    }, a.remaining);
  }

  stop(): void {
    const a = this.active;
    if (!a) return;
    if (a.timer !== null) window.clearTimeout(a.timer);
    a.resolve();
    this.active = null;
  }
}
