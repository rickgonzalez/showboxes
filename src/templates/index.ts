import { registerTemplate } from './registry';
import { titleBulletsTemplate } from './title-bullets';
import { codeZoomTemplate } from './code-zoom';

/**
 * Register all built-in templates. Importing this file for its side
 * effect is how the Presenter ends up knowing what templates exist.
 * User/agent code can call registerTemplate() later to add more.
 */
registerTemplate(titleBulletsTemplate);
registerTemplate(codeZoomTemplate);

export { registerTemplate, getTemplate, listTemplates } from './registry';
export type { Template, TemplateContent, TemplateHandle } from './registry';
