import type { Template, TemplateHandle } from './registry';
import type { EffectSpec } from '../core/types';
import type { TextBoxHandle } from '../service/presenter';

/**
 * emphasis-word — a single word or short phrase rendered large on the canvas
 * with dramatic entrance effects. The "mic drop" moment. Optionally followed
 * by a subtitle that fades in below in the DOM layer.
 *
 * Slot schema:
 *   word:     string         — the big word/phrase
 *   subtitle: string         — optional supporting text (DOM)
 *   fx:       EffectSpec[]   — entrance effects (defaults to slam + glow)
 *   style:    { size, weight, color } — optional overrides
 */

interface EmphasisWordContent {
  word: string;
  subtitle?: string;
  fx?: EffectSpec[];
  style?: {
    size?: number;
    weight?: string;
    color?: string;
  };
}

export const emphasisWordTemplate: Template = {
  id: 'emphasis-word',
  description:
    'Large dramatic word on canvas with optional subtitle. Built for verdict statements and key reveals.',
  slots: {
    word: 'string — the headline word or short phrase',
    subtitle: 'string — optional supporting text that fades in below',
    fx: 'EffectSpec[] — entrance effects (defaults to slam + glow)',
    style: '{ size?: number, weight?: string, color?: string } — optional overrides',
  },
  demo: {
    label: 'Emphasis Word',
    content: {
      word: 'FRAGILE',
      subtitle: 'This codebase has no tests and 3 god functions over 500 lines each.',
      fx: [
        { name: 'slam', duration: 520 },
        { name: 'glow', duration: 1400, strength: 48, color: '#ff6b6b' },
        { name: 'shake', duration: 400, intensity: 8 },
      ],
      style: { size: 120, weight: '900', color: '#ff6b6b' },
    },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as EmphasisWordContent;
    const {
      word,
      subtitle,
      fx = [
        { name: 'slam', duration: 520 },
        { name: 'glow', duration: 1400, strength: 48, color: '#ffeb3b' },
      ],
      style: styleOverride = {},
    } = content;

    const color = styleOverride.color ?? '#ffffff';
    const size = styleOverride.size ?? 120;
    const weight = styleOverride.weight ?? '900';

    // The word itself — big, canvas-rendered, with dramatic effects.
    const wordHandle: TextBoxHandle = presenter.showTextBox({
      text: word,
      style: {
        font: 'system-ui, -apple-system, sans-serif',
        size,
        weight,
        color,
        shadow: { color: 'rgba(0,0,0,.6)', blur: 20, offsetX: 0, offsetY: 4 },
        padding: 40,
      },
      // Slightly above center so the subtitle has room below.
      y: subtitle ? presenter.stage.height * 0.38 : undefined,
      fx,
    });

    // Subtitle in the DOM layer — fades in after the word lands.
    let subtitleEl: HTMLDivElement | null = null;
    if (subtitle) {
      subtitleEl = document.createElement('div');
      subtitleEl.className = 'sb-emphasis-subtitle';
      subtitleEl.textContent = subtitle;
      presenter.domRoot.appendChild(subtitleEl);

      // Delay the fade-in so the word has time to land.
      requestAnimationFrame(() => {
        setTimeout(() => subtitleEl?.classList.add('sb-visible'), 700);
      });
    }

    const handle: TemplateHandle = {
      dismiss: () => {
        wordHandle.dismiss();
        subtitleEl?.remove();
      },
      emphasize: (_target) => {
        // Re-trigger the glow on the word for re-emphasis.
        wordHandle.applyFx({ name: 'glow', duration: 1000, strength: 56, color });
      },
    };
    return handle;
  },
};
