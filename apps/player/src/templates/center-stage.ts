import type { Template, TemplateHandle } from './registry';
import type { EffectSpec } from '../core/types';
import type { TextBoxHandle } from '../service/presenter';

/**
 * center-stage — a central concept rendered large on the canvas, with related
 * terms orbiting around it. Weight drives relative size and glow intensity.
 * The center appears first, then orbiters stagger in with a grow effect.
 * An optional slow orbit rotation can be enabled.
 *
 * Slot schema:
 *   center:     { text: string, size?: number }
 *   orbiting:   { text: string, weight: number }[]   (weight 0–1)
 *   staggerMs:  number (delay between each orbiter, default 200)
 *   orbitSpeed: number (radians/frame for rotation, default 0 = static)
 *   centerFx:   EffectSpec[] (optional, defaults to slam)
 */

interface OrbiterSpec {
  text: string;
  weight: number;
}

interface CenterStageContent {
  center: { text: string; size?: number };
  orbiting?: OrbiterSpec[];
  staggerMs?: number;
  orbitSpeed?: number;
  centerFx?: EffectSpec[];
}

export const centerStageTemplate: Template = {
  id: 'center-stage',
  description:
    'Central concept on canvas with related terms orbiting around it. Weight drives size and glow.',
  slots: {
    center: '{ text: string, size?: number } — the central concept',
    orbiting: '{ text: string, weight: number }[] — satellite terms (weight 0-1)',
    staggerMs: 'number — delay between orbiter entrances (default 200)',
    orbitSpeed: 'number — radians/frame for slow rotation (default 0 = static)',
    centerFx: 'EffectSpec[] — entrance effects for the center word',
  },
  demo: {
    label: 'Center Stage',
    content: {
      center: { text: 'Presenter', size: 72 },
      orbiting: [
        { text: 'Stage', weight: 0.9 },
        { text: 'TextBox', weight: 0.8 },
        { text: 'fx registry', weight: 0.7 },
        { text: 'Templates', weight: 0.85 },
        { text: 'DOM Layer', weight: 0.6 },
        { text: 'Stage3D', weight: 0.3 },
      ],
      staggerMs: 200,
      orbitSpeed: 0.003,
    },
    emphasizeAfter: { target: 'Templates', delayMs: 3000 },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as CenterStageContent;
    const {
      center,
      orbiting = [],
      staggerMs = 200,
      orbitSpeed = 0,
      centerFx = [{ name: 'slam', duration: 600 }],
    } = content;

    const stageW = presenter.stage.width;
    const stageH = presenter.stage.height;
    const cx = stageW / 2;
    const cy = stageH / 2;

    // Center word — large, prominent.
    const centerSize = center.size ?? 72;
    const centerHandle: TextBoxHandle = presenter.showTextBox({
      text: center.text,
      style: {
        font: 'system-ui, -apple-system, sans-serif',
        size: centerSize,
        weight: '800',
        color: '#ffffff',
        shadow: { color: 'rgba(0,0,0,.5)', blur: 18, offsetX: 0, offsetY: 4 },
        padding: 32,
      },
      x: cx,
      y: cy,
      fx: centerFx,
    });

    // Orbit radius — responsive to stage size.
    const orbitRadius = Math.min(stageW, stageH) * 0.3;

    // Compute base angles for even distribution.
    const count = orbiting.length;
    const angleStep = count > 0 ? (2 * Math.PI) / count : 0;
    let baseAngleOffset = 0;

    // Track orbiter handles for cleanup and animation.
    const orbiterHandles: TextBoxHandle[] = [];
    const orbiterAngles: number[] = [];
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Stagger orbiters in.
    orbiting.forEach((spec, i) => {
      const angle = -Math.PI / 2 + i * angleStep; // start from top
      orbiterAngles.push(angle);

      const tid = setTimeout(() => {
        const orbSize = 20 + spec.weight * 32; // 20px at weight 0, 52px at weight 1
        const glowStrength = spec.weight * 36;
        const ox = cx + Math.cos(angle) * orbitRadius;
        const oy = cy + Math.sin(angle) * orbitRadius;

        const h = presenter.showTextBox({
          text: spec.text,
          style: {
            font: 'system-ui, -apple-system, sans-serif',
            size: orbSize,
            weight: spec.weight > 0.7 ? '700' : '500',
            color: lerpColor(spec.weight),
            shadow: { color: 'rgba(0,0,0,.4)', blur: 10, offsetX: 0, offsetY: 2 },
            padding: 16,
          },
          x: ox,
          y: oy,
          fx: [
            { name: 'grow', duration: 500, from: 0, to: 1 },
            ...(glowStrength > 10
              ? [{ name: 'glow', duration: 1200, strength: glowStrength, color: lerpColor(spec.weight) }]
              : []),
          ],
        });
        orbiterHandles.push(h);
      }, staggerMs * (i + 1));

      timeouts.push(tid);
    });

    // Optional slow orbit rotation via rAF.
    let rafId = 0;
    if (orbitSpeed > 0 && count > 0) {
      const tick = () => {
        baseAngleOffset += orbitSpeed;
        orbiterHandles.forEach((h, i) => {
          const angle = orbiterAngles[i] + baseAngleOffset;
          h.box.x = cx + Math.cos(angle) * orbitRadius;
          h.box.y = cy + Math.sin(angle) * orbitRadius;
        });
        rafId = requestAnimationFrame(tick);
      };
      // Start rotation after all orbiters have appeared.
      const rotateDelay = staggerMs * (count + 2);
      const rotTid = setTimeout(() => {
        rafId = requestAnimationFrame(tick);
      }, rotateDelay);
      timeouts.push(rotTid);
    }

    const handle: TemplateHandle = {
      dismiss: () => {
        centerHandle.dismiss();
        orbiterHandles.forEach((h) => h.dismiss());
        timeouts.forEach(clearTimeout);
        if (rafId) cancelAnimationFrame(rafId);
      },
      emphasize: (target) => {
        // Find an orbiter by text and pulse it.
        const i = Number(target);
        const h = Number.isFinite(i) ? orbiterHandles[i] : orbiterHandles.find(
          (oh) => oh.box.text.toLowerCase() === target.toLowerCase()
        );
        if (h) {
          h.applyFx({ name: 'glow', duration: 1000, strength: 50, color: '#ffeb3b' });
          h.applyFx({ name: 'shake', duration: 400, intensity: 6 });
        }
      },
    };
    return handle;
  },
};

/**
 * Map a weight (0–1) to a color along a blue→white gradient.
 * Low-weight items are a muted blue-gray; high-weight items are bright white.
 */
function lerpColor(weight: number): string {
  const lo = [120, 150, 200]; // muted blue-gray
  const hi = [255, 255, 255]; // bright white
  const r = Math.round(lo[0] + (hi[0] - lo[0]) * weight);
  const g = Math.round(lo[1] + (hi[1] - lo[1]) * weight);
  const b = Math.round(lo[2] + (hi[2] - lo[2]) * weight);
  return `rgb(${r}, ${g}, ${b})`;
}
