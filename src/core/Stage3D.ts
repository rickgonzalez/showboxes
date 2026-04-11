/**
 * Stage3D — placeholder for the 3D shape layer.
 *
 * When we add 3D, this will wrap a Three.js renderer in a sibling <canvas>
 * absolutely positioned over or under the 2D stage, exposing a service API
 * like `showShape3D({ kind: "cube", ... })` mirroring the 2D primitives.
 *
 * Left as a stub so the rest of the codebase has a clear seam for the
 * future extension without forcing the three.js dependency today.
 */

export interface Stage3DPlaceholder {
  readonly kind: 'stub';
}

export function createStage3DStub(): Stage3DPlaceholder {
  return { kind: 'stub' };
}
