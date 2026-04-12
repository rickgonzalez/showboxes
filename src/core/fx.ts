import anime from 'animejs';
import type { TextBox } from './TextBox';

/**
 * Effects registry.
 *
 * An effect is a function that takes a TextBox and a params object and
 * returns an anime.js instance. Effects mutate the TextBox's animated
 * properties (scale, alpha, offsetX, glow, etc.) — they never touch the
 * offscreen cache, so animation is cheap.
 *
 * Adding a new effect is as simple as calling registerFx("myEffect", fn).
 */

export type FxParams = Record<string, unknown>;

export type FxFunction = (target: TextBox, params: FxParams) => anime.AnimeInstance | void;

const registry: Record<string, FxFunction> = {};

/**
 * zoom: scale from `from` to `to` with an ease-out curve.
 * Good for "focus in" on something.
 */
registry.zoom = (target, params) => {
  const duration = asNumber(params.duration, 600);
  const from = asNumber(params.from, 0);
  const to = asNumber(params.to, 1);
  target.scale = from;
  return anime({
    targets: target,
    scale: to,
    duration,
    easing: 'easeOutCubic',
  });
};

/**
 * grow: scale up past the target then settle, with elastic easing.
 * Good for "this just got bigger and stayed there".
 */
registry.grow = (target, params) => {
  const duration = asNumber(params.duration, 800);
  const from = asNumber(params.from, 1);
  const to = asNumber(params.to, 1.4);
  target.scale = from;
  return anime({
    targets: target,
    scale: to,
    duration,
    easing: 'easeOutElastic(1, .6)',
  });
};

/**
 * glow: pulse the animated shadow blur. Non-destructive — runs alongside
 * any static drop shadow set in the style.
 */
registry.glow = (target, params) => {
  const duration = asNumber(params.duration, 1200);
  const strength = asNumber(params.strength, 32);
  const color = asString(params.color, '#ffeb3b');
  target.glowColor = color;
  return anime({
    targets: target,
    glow: [
      { value: 0, duration: 0 },
      { value: strength, duration: duration / 2, easing: 'easeInQuad' },
      { value: strength * 0.6, duration: duration / 2, easing: 'easeOutQuad' },
    ],
  });
};

/**
 * slam: fast scale-down-and-bounce entrance. Starts huge and invisible,
 * lands at the target scale with a bounce.
 */
registry.slam = (target, params) => {
  const duration = asNumber(params.duration, 520);
  const scale = asNumber(params.scale, 1);
  target.scale = scale * 3;
  target.alpha = 0;
  return anime({
    targets: target,
    scale,
    alpha: 1,
    duration,
    easing: 'easeOutBounce',
  });
};

/**
 * shake: horizontal jitter that decays to zero. Useful for emphasis or
 * "wrong answer" feedback.
 */
registry.shake = (target, params) => {
  const duration = asNumber(params.duration, 400);
  const intensity = asNumber(params.intensity, 10);
  const step = duration / 8;
  return anime({
    targets: target,
    offsetX: [
      { value: -intensity, duration: step },
      { value: intensity, duration: step },
      { value: -intensity * 0.6, duration: step },
      { value: intensity * 0.6, duration: step },
      { value: -intensity * 0.3, duration: step },
      { value: intensity * 0.3, duration: step },
      { value: 0, duration: step },
    ],
    easing: 'linear',
  });
};

/**
 * fadeOut: fade to transparent. Useful as a dismissal effect.
 */
registry.fadeOut = (target, params) => {
  const duration = asNumber(params.duration, 400);
  return anime({
    targets: target,
    alpha: 0,
    duration,
    easing: 'easeInQuad',
  });
};

/** Register a new effect (or override an existing one). */
export function registerFx(name: string, fn: FxFunction): void {
  registry[name] = fn;
}

/** Apply an effect spec to a target. Unknown effects are warned and skipped. */
export function applyFx(target: TextBox, spec: { name: string } & FxParams): anime.AnimeInstance | void {
  const fn = registry[spec.name];
  if (!fn) {
    console.warn(`[showboxes/fx] unknown effect: ${spec.name}`);
    return;
  }
  return fn(target, spec);
}

/** List all registered effect names (useful for agent tool discovery). */
export function listFx(): string[] {
  return Object.keys(registry);
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
