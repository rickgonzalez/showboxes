/**
 * Tuning constants shared between client, server, and agent prompts.
 *
 * Import from here — do not inline these values. When they drift, the
 * modal's UX, the API's Zod default, and the gnome prompt all disagree.
 * See CS-13 for history.
 */

/** Default depth slider value for focused-brief mode (0..1). */
export const DEFAULT_DEPTH = 0.3;

/**
 * File count at/above which a repo is treated as "large."
 * - Modal uses this to auto-default the mode to focused-brief.
 * - Analysis gnome prompt interpolates it to scope file reads.
 */
export const LARGE_REPO_FILE_THRESHOLD = 300;
