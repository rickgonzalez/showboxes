/**
 * Canonical design-surface size that the player's visual templates are
 * authored against. Templates use absolute-pixel positioning (e.g.
 * `top: 260px`), so embedders must wrap `<Presentation>` in a fixed-size
 * box at these dimensions and scale it with a CSS transform to fit the
 * host container without overflow.
 *
 * Consumers that want to experiment pass a `designSize={{ width, height }}`
 * prop to HeroPlayer / GenerateFlow instead of editing this default.
 *
 * Current default is 1280×1280 (the size HeroPlayer was originally
 * tuned against). Shrinking the default *enlarges* rendered content in
 * the same host box, since the scale math is
 *   scale = min(box.width / design.width, box.height / design.height)
 */
export interface DesignSize {
  width: number;
  height: number;
}

export const DEFAULT_DESIGN_SIZE: DesignSize = {
  width: 1280,
  height: 1280,
};
