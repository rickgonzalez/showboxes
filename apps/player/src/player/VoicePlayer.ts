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

/**
 * WebSpeechVoicePlayer — real audio via the browser's SpeechSynthesis API.
 *
 * Temporary narration surface until we wire ElevenLabs/Kokoro. Zero deps,
 * zero keys, works offline. Voice quality varies by OS (macOS is good,
 * Chrome-on-Linux is rough) but it's sufficient to validate beat timing
 * and scene pacing against real audio.
 *
 * Timing contract: `durationMs` is an *estimate* returned synchronously
 * (ScriptPlayer needs it immediately to schedule beats + scene advance).
 * The `done` promise resolves on the utterance's real `onend` event, so
 * the promise is truth but the number is a forecast. If you see beats
 * firing noticeably before/after the narration they anchor to, tune the
 * wordsPerMinute constant or have Agent 2 emit explicit holdSeconds.
 */
export interface WebSpeechOptions {
  /** Preferred voice name substring (e.g. "Samantha", "Daniel"). First match wins. */
  voiceName?: string;
  /** Preferred BCP-47 lang (e.g. "en-US"). Used if voiceName doesn't match. */
  lang?: string;
  /** Pitch 0..2. Default 1. */
  pitch?: number;
  /**
   * Words per minute assumed for duration estimates at speed=1.
   * Web Speech at rate=1 on macOS is ~180 wpm; default 150 holds scenes
   * a bit longer so animations don't race ahead of the voice.
   */
  wordsPerMinute?: number;
}

export class WebSpeechVoicePlayer implements VoicePlayer {
  private synth: SpeechSynthesis;
  private current: SpeechSynthesisUtterance | null = null;
  private resolveDone: (() => void) | null = null;
  private opts: Required<Pick<WebSpeechOptions, 'pitch' | 'wordsPerMinute'>> &
    Pick<WebSpeechOptions, 'voiceName' | 'lang'>;

  constructor(opts: WebSpeechOptions = {}) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      throw new Error('WebSpeechVoicePlayer: speechSynthesis not available');
    }
    this.synth = window.speechSynthesis;
    this.opts = {
      pitch: opts.pitch ?? 1,
      wordsPerMinute: opts.wordsPerMinute ?? 150,
      voiceName: opts.voiceName,
      lang: opts.lang ?? 'en-US',
    };
    // Nudge Chrome to populate the voice list.
    this.synth.getVoices();
  }

  speak(text: string, opts?: { speed?: number }): SpeakHandle {
    this.stop();

    const speed = opts?.speed ?? 1.0;
    const words = Math.max(1, text.trim().split(/\s+/).length);
    const durationMs = Math.round(
      (words / this.opts.wordsPerMinute) * 60_000 / speed
    );

    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = speed;
    utter.pitch = this.opts.pitch;
    utter.lang = this.opts.lang ?? 'en-US';
    const voice = this.pickVoice();
    if (voice) utter.voice = voice;

    const settle = () => {
      if (this.current === utter) {
        this.current = null;
        this.resolveDone = null;
        resolveDone();
      }
    };
    utter.onend = settle;
    utter.onerror = settle;

    this.current = utter;
    this.resolveDone = resolveDone;
    this.synth.speak(utter);

    return {
      durationMs,
      done,
      cancel: () => this.stop(),
    };
  }

  pause(): void {
    if (this.current) this.synth.pause();
  }

  resume(): void {
    if (this.current) this.synth.resume();
  }

  stop(): void {
    if (!this.current) return;
    const resolve = this.resolveDone;
    this.current = null;
    this.resolveDone = null;
    this.synth.cancel();
    resolve?.();
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = this.synth.getVoices();
    if (voices.length === 0) return null;
    if (this.opts.voiceName) {
      const byName = voices.find((v) =>
        v.name.toLowerCase().includes(this.opts.voiceName!.toLowerCase())
      );
      if (byName) return byName;
    }
    if (this.opts.lang) {
      const byLang = voices.find((v) => v.lang === this.opts.lang);
      if (byLang) return byLang;
    }
    return voices[0];
  }
}
