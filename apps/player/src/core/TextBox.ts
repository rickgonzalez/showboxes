import type { Renderable } from './Stage';
import type { TextStyle } from './types';

/**
 * TextBox renders a single string to an offscreen canvas (the "cache") once,
 * then blits that cache to the main canvas every frame. This is the classic
 * blit pattern: rasterizing text every frame is expensive, but drawImage of
 * a pre-rendered bitmap is effectively free.
 *
 * Animated properties (scale, rotation, alpha, glow, offset) are applied at
 * draw time via ctx.save/translate/scale — they do NOT invalidate the cache.
 * Only changes to the text or the style (font, color, padding, etc.) cause
 * a rebuild.
 *
 * Effects in fx.ts mutate these animated properties directly via anime.js.
 */

type ResolvedStyle = Required<Omit<TextStyle, 'stroke' | 'shadow'>> & {
  stroke: { color: string; width: number };
  shadow: { color: string; blur: number; offsetX: number; offsetY: number };
};

const DEFAULT_STYLE: ResolvedStyle = {
  font: 'system-ui, -apple-system, sans-serif',
  size: 48,
  weight: 'bold',
  color: '#ffffff',
  stroke: { color: '', width: 0 },
  shadow: { color: '', blur: 0, offsetX: 0, offsetY: 0 },
  padding: 24,
  bgColor: '',
  borderRadius: 12,
};

export class TextBox implements Renderable {
  text: string;
  style: ResolvedStyle;

  // Position (center of the box in CSS pixels).
  x = 0;
  y = 0;

  // Animated transform. Effects mutate these directly.
  scale = 1;
  rotation = 0;
  alpha = 1;

  // Animated glow (distinct from the static `style.shadow`).
  glow = 0;
  glowColor = '#ffffff';

  // Animated positional offset, used by shake/slam.
  offsetX = 0;
  offsetY = 0;

  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  private cacheWidth = 0;
  private cacheHeight = 0;

  constructor(text: string, style: TextStyle = {}) {
    this.text = text;
    this.style = resolveStyle(style);
  }

  /** Update the text or style and invalidate the cache on next render. */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.cacheKey = '';
  }

  setStyle(style: TextStyle): void {
    this.style = resolveStyle({ ...this.style, ...style });
    this.cacheKey = '';
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.ensureCache();
    if (!this.cache) return;

    const w = this.cacheWidth;
    const h = this.cacheHeight;

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x + this.offsetX, this.y + this.offsetY);
    if (this.rotation !== 0) ctx.rotate(this.rotation);
    if (this.scale !== 1) ctx.scale(this.scale, this.scale);

    if (this.glow > 0) {
      ctx.shadowColor = this.glowColor;
      ctx.shadowBlur = this.glow;
    }

    ctx.drawImage(this.cache, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private ensureCache(): void {
    const s = this.style;
    const fontStr = `${s.weight} ${s.size}px ${s.font}`;
    // Key covers everything that affects the rasterized bitmap.
    const key = [
      this.text,
      fontStr,
      s.color,
      s.padding,
      s.bgColor,
      s.borderRadius,
      s.stroke.color,
      s.stroke.width,
      s.shadow.color,
      s.shadow.blur,
      s.shadow.offsetX,
      s.shadow.offsetY,
    ].join('|');
    if (key === this.cacheKey && this.cache) return;

    // Measure with a throwaway context.
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = fontStr;
    const metrics = measure.measureText(this.text);
    const textWidth = metrics.width;
    // Use the font size as a proxy for line height; good enough for one-line labels.
    const textHeight = s.size * 1.2;

    // Expand for stroke and static drop shadow so we don't clip.
    const strokePad = s.stroke.width;
    const shadowPad =
      s.shadow.color && s.shadow.blur > 0
        ? s.shadow.blur + Math.max(Math.abs(s.shadow.offsetX), Math.abs(s.shadow.offsetY))
        : 0;
    const extraPad = Math.max(strokePad, shadowPad);

    const w = textWidth + (s.padding + extraPad) * 2;
    const h = textHeight + (s.padding + extraPad) * 2;

    const dpr = window.devicePixelRatio || 1;
    const cache = document.createElement('canvas');
    cache.width = Math.max(1, Math.ceil(w * dpr));
    cache.height = Math.max(1, Math.ceil(h * dpr));
    const cctx = cache.getContext('2d')!;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background fill (rounded rect).
    if (s.bgColor) {
      cctx.fillStyle = s.bgColor;
      roundRect(cctx, extraPad, extraPad, w - extraPad * 2, h - extraPad * 2, s.borderRadius);
      cctx.fill();
    }

    // Static drop shadow (distinct from the animated glow applied at draw time).
    if (s.shadow.color && s.shadow.blur > 0) {
      cctx.shadowColor = s.shadow.color;
      cctx.shadowBlur = s.shadow.blur;
      cctx.shadowOffsetX = s.shadow.offsetX;
      cctx.shadowOffsetY = s.shadow.offsetY;
    }

    cctx.font = fontStr;
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';

    if (s.stroke.color && s.stroke.width > 0) {
      cctx.strokeStyle = s.stroke.color;
      cctx.lineWidth = s.stroke.width;
      cctx.lineJoin = 'round';
      cctx.strokeText(this.text, w / 2, h / 2);
    }

    cctx.fillStyle = s.color;
    cctx.fillText(this.text, w / 2, h / 2);

    this.cache = cache;
    this.cacheKey = key;
    this.cacheWidth = w;
    this.cacheHeight = h;
  }
}

function resolveStyle(style: TextStyle): ResolvedStyle {
  return {
    ...DEFAULT_STYLE,
    ...style,
    stroke: { ...DEFAULT_STYLE.stroke, ...(style.stroke ?? {}) },
    shadow: { ...DEFAULT_STYLE.shadow, ...(style.shadow ?? {}) },
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
