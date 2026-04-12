/**
 * Shared types for the showboxes core renderer and service layer.
 *
 * The style object is intentionally shaped as a close cousin of
 * CanvasRenderingContext2D text properties so there is no translation layer.
 */

export interface TextStyle {
  /** CSS-style font family string, e.g. "system-ui, sans-serif". */
  font?: string;
  /** Font size in CSS pixels. */
  size?: number;
  /** Font weight, e.g. "bold", "600". */
  weight?: string;
  /** Fill color for the glyphs. */
  color?: string;
  /** Optional stroke drawn behind the fill. */
  stroke?: { color: string; width: number };
  /** Optional drop shadow (separate from the animated glow effect). */
  shadow?: { color: string; blur: number; offsetX?: number; offsetY?: number };
  /** Padding around the text inside the box, in CSS pixels. */
  padding?: number;
  /** Optional background fill drawn behind the text. */
  bgColor?: string;
  /** Corner radius for the background fill. */
  borderRadius?: number;
}

/**
 * A single effect invocation. The `name` selects an entry from the fx
 * registry; any other fields are passed through to the effect function as
 * parameters. This is the structured shape an agent will emit.
 */
export interface EffectSpec {
  name: string;
  [key: string]: unknown;
}

/** Object form of the showTextBox call — the agent-friendly surface. */
export interface TextBoxOptions {
  text: string;
  style?: TextStyle;
  /** Center x in CSS pixels. Defaults to stage center. */
  x?: number;
  /** Center y in CSS pixels. Defaults to stage center. */
  y?: number;
  fx?: EffectSpec[];
}
