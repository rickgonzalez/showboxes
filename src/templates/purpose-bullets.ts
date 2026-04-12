import type { Template, TemplateHandle } from './registry';
import type { EffectSpec } from '../core/types';

/**
 * purpose-bullets — a purpose-driven layout that states what a module/function
 * does, anchors it to a file reference, and lists supporting evidence with
 * type-driven color coding (feature, detail, concern, strength).
 *
 * The purpose headline is rendered on the canvas with an entrance effect.
 * The file reference badge and supporting points are rendered in the DOM layer.
 *
 * Slot schema:
 *   purpose:   string       — the main purpose statement
 *   fileRef:   string       — optional file path badge (e.g. "src/services/auth.ts")
 *   supports:  SupportItem[] — evidence/detail items
 *   purposeFx: EffectSpec[] — optional entrance effects (defaults to grow)
 */

interface SupportItem {
  point: string;
  type: 'feature' | 'detail' | 'concern' | 'strength';
}

interface PurposeBulletsContent {
  purpose: string;
  fileRef?: string;
  supports?: SupportItem[];
  purposeFx?: EffectSpec[];
}

const TYPE_ICONS: Record<SupportItem['type'], string> = {
  feature: '\u25B6',   // right-pointing triangle
  detail: '\u25CB',    // open circle
  concern: '\u26A0',   // warning sign
  strength: '\u2713',  // check mark
};

export const purposeBulletsTemplate: Template = {
  id: 'purpose-bullets',
  description:
    'Purpose statement on canvas with typed supporting evidence in DOM. File reference badge optional.',
  slots: {
    purpose: 'string — the main purpose headline, rendered on canvas',
    fileRef: 'string — optional file path shown as a badge',
    supports: 'SupportItem[] — { point: string, type: feature|detail|concern|strength }',
    purposeFx: 'EffectSpec[] — optional entrance effects for the purpose text',
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as PurposeBulletsContent;
    const {
      purpose,
      fileRef,
      supports = [],
      purposeFx = [{ name: 'grow', duration: 700, from: 0.6, to: 1 }],
    } = content;

    // Purpose headline on the canvas layer.
    const purposeHandle = presenter.showTextBox({
      text: purpose,
      style: {
        font: 'system-ui, -apple-system, sans-serif',
        size: 52,
        weight: '700',
        color: '#ffffff',
        shadow: { color: 'rgba(0,0,0,.45)', blur: 14, offsetX: 0, offsetY: 3 },
        padding: 28,
      },
      y: 120,
      fx: purposeFx,
    });

    // Container for DOM content.
    const container = document.createElement('div');
    container.className = 'sb-purpose-container';

    // File reference badge (if provided).
    if (fileRef) {
      const badge = document.createElement('span');
      badge.className = 'sb-purpose-file-ref';
      badge.textContent = fileRef;
      container.appendChild(badge);
    }

    // Supporting evidence list.
    const list = document.createElement('ul');
    list.className = 'sb-purpose-supports';
    const items: HTMLLIElement[] = [];

    for (const s of supports) {
      const li = document.createElement('li');
      li.className = `sb-purpose-item sb-purpose-type-${s.type}`;

      const icon = document.createElement('span');
      icon.className = 'sb-purpose-icon';
      icon.textContent = TYPE_ICONS[s.type] ?? '\u25CB';
      li.appendChild(icon);

      const text = document.createElement('span');
      text.textContent = s.point;
      li.appendChild(text);

      list.appendChild(li);
      items.push(li);
    }

    container.appendChild(list);
    presenter.domRoot.appendChild(container);

    // Stagger items in with CSS transitions.
    requestAnimationFrame(() => {
      items.forEach((li, i) => {
        setTimeout(() => li.classList.add('sb-visible'), 300 + i * 140);
      });
    });

    const handle: TemplateHandle = {
      dismiss: () => {
        purposeHandle.dismiss();
        container.remove();
      },
      emphasize: (target) => {
        const i = Number(target);
        const match = Number.isFinite(i)
          ? items[i]
          : items.find((li) => li.textContent?.includes(target));
        if (match) {
          match.classList.add('sb-purpose-emphasize');
          setTimeout(() => match.classList.remove('sb-purpose-emphasize'), 1400);
        }
      },
    };
    return handle;
  },
};
