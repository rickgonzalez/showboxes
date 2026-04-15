import type { Template, TemplateHandle } from './registry';
import type { EffectSpec } from '../core/types';

/**
 * title-bullets — a large title on the canvas layer with a bulleted body
 * rendered in the DOM layer. The title gets an entrance effect (default:
 * slam). Bullets stagger in with CSS transitions.
 *
 * Slot schema:
 *   title:    string
 *   bullets:  string[]
 *   titleFx:  EffectSpec[]  (optional, defaults to [{ name: "slam" }])
 */

interface TitleBulletsContent {
  title: string;
  bullets?: string[];
  titleFx?: EffectSpec[];
}

export const titleBulletsTemplate: Template = {
  id: 'title-bullets',
  description: 'Large canvas title with a staggered DOM bullet list below.',
  slots: {
    title: 'string — the headline, rendered on canvas',
    bullets: 'string[] — list items, rendered in DOM',
    titleFx: 'EffectSpec[] — optional entrance effects for the title',
  },
  demo: {
    label: 'Title + Bullets',
    content: {
      title: 'Why blitting matters',
      bullets: [
        'Rasterize once into an offscreen canvas.',
        'drawImage the cached bitmap every frame.',
        'Animated transforms are free — no re-rasterization.',
        'The cache only rebuilds when text or style changes.',
      ],
      titleFx: [{ name: 'slam', duration: 600 }],
    },
    emphasizeAfter: { target: '1', delayMs: 1800 },
  },
  render(presenter, contentIn) {
    const content = contentIn as unknown as TitleBulletsContent;
    const { title, bullets = [], titleFx = [{ name: 'slam', duration: 600 }] } = content;

    // Title on the canvas layer.
    const titleHandle = presenter.showTextBox({
      text: title,
      style: {
        font: 'system-ui, -apple-system, sans-serif',
        size: 72,
        weight: '800',
        color: '#ffffff',
        shadow: { color: 'rgba(0,0,0,.5)', blur: 16, offsetX: 0, offsetY: 4 },
        padding: 32,
      },
      y: 140,
      fx: titleFx,
    });

    // Bullets in the DOM layer.
    const list = document.createElement('ul');
    list.className = 'sb-bullets';
    const items: HTMLLIElement[] = [];
    for (const b of bullets) {
      const li = document.createElement('li');
      li.textContent = b;
      list.appendChild(li);
      items.push(li);
    }
    presenter.domRoot.appendChild(list);

    // Stagger them in. CSS transitions on opacity + translateY.
    requestAnimationFrame(() => {
      items.forEach((li, i) => {
        setTimeout(() => li.classList.add('sb-visible'), 250 + i * 120);
      });
    });

    const handle: TemplateHandle = {
      dismiss: () => {
        titleHandle.dismiss();
        list.remove();
      },
      emphasize: (target) => {
        // target can be an index ("0", "1") or the bullet text.
        const i = Number(target);
        const match = Number.isFinite(i)
          ? items[i]
          : items.find((li) => li.textContent === target);
        if (match) {
          match.classList.add('sb-emphasize');
          setTimeout(() => match.classList.remove('sb-emphasize'), 1400);
        }
      },
    };
    return handle;
  },
};
