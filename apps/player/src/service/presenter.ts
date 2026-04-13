import { Stage } from '../core/Stage';
import { Stage3D } from '../core/Stage3D';
import { TextBox } from '../core/TextBox';
import { applyFx, listFx } from '../core/fx';
import type { EffectSpec, TextBoxOptions, TextStyle } from '../core/types';
import { getTemplate, listTemplates } from '../templates/registry';
import type { TemplateContent, TemplateHandle } from '../templates/registry';

/**
 * Presenter is the service facade that agent tools (and humans) call into.
 * It owns one canvas Stage and one DOM root (the layered HTML container).
 *
 *   - Canvas layer → effect text boxes and 2D shapes (via Stage).
 *   - DOM layer    → body text, code blocks, anything that benefits from
 *                    native text layout (via the domRoot element).
 *
 * The service exposes two surfaces:
 *
 *   showTextBox(opts)                         // object form — agent-friendly
 *   showTextBox(text, style, name, ...args)   // positional form — human-friendly
 *
 * Both resolve to the same underlying call.
 */

export interface TextBoxHandle {
  box: TextBox;
  dismiss(): void;
  applyFx(spec: EffectSpec): void;
}

export class Presenter {
  readonly stage: Stage;
  readonly domRoot: HTMLElement;
  /** 3D layer host — lazily created the first time a template asks for it. */
  private stage3dHost: HTMLElement | null;
  private _stage3d: Stage3D | null = null;

  constructor(canvas: HTMLCanvasElement, domRoot: HTMLElement, stage3dHost?: HTMLElement) {
    this.stage = new Stage(canvas);
    this.domRoot = domRoot;
    this.stage3dHost = stage3dHost ?? null;
  }

  /**
   * Lazy accessor for the 3D stage. Only constructs (and loads three.js
   * scenery) when a template actually needs it. Returns null if no
   * 3D host element was provided to the Presenter.
   */
  get stage3d(): Stage3D | null {
    if (this._stage3d) return this._stage3d;
    if (!this.stage3dHost) return null;
    this._stage3d = new Stage3D(this.stage3dHost);
    return this._stage3d;
  }

  /** Object form — what the agent will emit. */
  showTextBox(opts: TextBoxOptions): TextBoxHandle;
  /** Positional form — mytext.css, zoom, 20, 100 style. */
  showTextBox(
    text: string,
    style?: TextStyle,
    fxName?: string,
    ...fxArgs: unknown[]
  ): TextBoxHandle;
  showTextBox(
    textOrOpts: string | TextBoxOptions,
    style?: TextStyle,
    fxName?: string,
    ...fxArgs: unknown[]
  ): TextBoxHandle {
    const opts: TextBoxOptions =
      typeof textOrOpts === 'string'
        ? {
            text: textOrOpts,
            style,
            fx: fxName ? [positionalToSpec(fxName, fxArgs)] : [],
          }
        : textOrOpts;

    const box = new TextBox(opts.text, opts.style);
    box.x = opts.x ?? this.stage.width / 2;
    box.y = opts.y ?? this.stage.height / 2;
    this.stage.add(box);

    for (const spec of opts.fx ?? []) {
      applyFx(box, spec as { name: string } & Record<string, unknown>);
    }

    return {
      box,
      dismiss: () => this.stage.remove(box),
      applyFx: (spec) => applyFx(box, spec as { name: string } & Record<string, unknown>),
    };
  }

  /**
   * Render a template by id. Templates are the "set standards" layer —
   * an agent picks one based on content and passes structured slots.
   */
  present(spec: { template: string; content: TemplateContent }): TemplateHandle {
    const template = getTemplate(spec.template);
    if (!template) {
      throw new Error(`showboxes: unknown template "${spec.template}"`);
    }
    return template.render(this, spec.content);
  }

  /** Clear everything on all layers. Useful between slides. */
  clear(): void {
    this.stage.clear();
    while (this.domRoot.firstChild) this.domRoot.removeChild(this.domRoot.firstChild);
    this._stage3d?.clear();
  }

  /** Discovery helpers — useful when exposing this as an agent tool. */
  listEffects(): string[] {
    return listFx();
  }

  listTemplates(): Array<{ id: string; description: string }> {
    return listTemplates();
  }
}

/**
 * Map a positional fx call into an EffectSpec. The convention is that the
 * first unnamed numeric arg becomes `duration` and the second becomes the
 * primary value for the effect (intensity / scale / strength — whatever
 * that effect's main knob is). Each effect function decides how to
 * interpret what it was given and supplies sensible defaults for the rest.
 */
function positionalToSpec(name: string, args: unknown[]): EffectSpec {
  const spec: EffectSpec = { name };
  if (args.length >= 1) spec.duration = args[0];
  if (args.length >= 2) {
    // Stash the second arg under the common names the built-in effects
    // consult. Effects only read the keys they care about.
    const v = args[1];
    spec.value = v;
    spec.to = v;
    spec.strength = v;
    spec.intensity = v;
    spec.scale = v;
  }
  return spec;
}
