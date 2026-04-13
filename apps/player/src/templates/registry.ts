import type { Presenter } from '../service/presenter';

/**
 * Templates are the "set standards" layer sitting above the service
 * primitives. An agent picks a template based on the shape of its content
 * (a title and bullets, a code sample, a comparison, a quote, etc.) and
 * passes structured slots. The template decides how to lay those slots
 * out across the DOM and canvas layers.
 *
 * The content type is intentionally loose (Record<string, unknown>) so
 * templates can define their own slot schemas without changing the
 * registry. Individual templates should cast to a typed interface.
 */

export type TemplateContent = Record<string, unknown>;

export interface Template {
  id: string;
  description: string;
  /**
   * Machine-readable schema hint. Not validated here — intended for an
   * agent tool-discovery endpoint that wants to tell a model what slots
   * this template takes.
   */
  slots?: Record<string, string>;
  render(presenter: Presenter, content: TemplateContent): TemplateHandle;
}

export interface TemplateHandle {
  /** Remove everything the template added. */
  dismiss(): void;
  /** Optional: draw attention to a slot or sub-element. */
  emphasize?(target: string): void;
}

const templates = new Map<string, Template>();

export function registerTemplate(t: Template): void {
  templates.set(t.id, t);
}

export function getTemplate(id: string): Template | undefined {
  return templates.get(id);
}

export function listTemplates(): Array<{ id: string; description: string; slots?: Record<string, string> }> {
  return Array.from(templates.values()).map((t) => ({
    id: t.id,
    description: t.description,
    slots: t.slots,
  }));
}
