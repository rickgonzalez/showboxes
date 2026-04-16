/**
 * Shared palette for templates. Single source of truth for `palette.*`
 * aliases used in template content (e.g. `categoryColors`, `groups[].color`,
 * `accent`). Keep this file the *only* declaration of `PALETTE_DEFAULTS`.
 *
 * The aliases match what the Producer (Agent 2) is told it can emit — see
 * the visual primitives catalog in apps/server/lib/agents/producer.system-prompt.
 */

export const PALETTE_DEFAULTS: Record<string, string> = {
  'palette.primary': '#60a5fa',
  'palette.secondary': '#a78bfa',
  'palette.accent': '#34d399',
};

/**
 * Resolve a color input — either a `palette.*` alias or a CSS color string —
 * to a concrete CSS color. Unknown aliases fall back to `fallback`; any
 * non-alias string is returned as-is so callers can pass `#ff6b6b`,
 * `rgb(...)`, etc.
 *
 * `fallback` defaults to a neutral slate so that missing/garbage input still
 * renders something visible rather than `undefined`.
 */
export function resolveColor(input?: string, fallback = '#334155'): string {
  if (!input) return fallback;
  if (input.startsWith('palette.')) return PALETTE_DEFAULTS[input] ?? fallback;
  return input;
}
