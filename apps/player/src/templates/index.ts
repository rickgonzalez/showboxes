import { registerTemplate } from './registry';
import { titleBulletsTemplate } from './title-bullets';
import { codeZoomTemplate } from './code-zoom';
import { purposeBulletsTemplate } from './purpose-bullets';
import { emphasisWordTemplate } from './emphasis-word';
import { centerStageTemplate } from './center-stage';
import { codeCloudTemplate } from './code-cloud';
import { transformGridTemplate } from './transform-grid';
import { flowDiagramTemplate } from './flow-diagram';
import { sequenceDiagramTemplate } from './sequence-diagram';
import { stepJourneyTemplate } from './step-journey';
import { dataPipelineTemplate } from './data-pipeline';
import { scorecardTemplate } from './scorecard';
import { entityMapTemplate } from './entity-map';

/**
 * Register all built-in templates. Importing this file for its side
 * effect is how the Presenter ends up knowing what templates exist.
 * User/agent code can call registerTemplate() later to add more.
 */
registerTemplate(titleBulletsTemplate);
registerTemplate(codeZoomTemplate);
registerTemplate(purposeBulletsTemplate);
registerTemplate(emphasisWordTemplate);
registerTemplate(centerStageTemplate);
registerTemplate(codeCloudTemplate);
registerTemplate(transformGridTemplate);
registerTemplate(flowDiagramTemplate);
registerTemplate(sequenceDiagramTemplate);
registerTemplate(stepJourneyTemplate);
registerTemplate(dataPipelineTemplate);
registerTemplate(scorecardTemplate);
registerTemplate(entityMapTemplate);

export { registerTemplate, getTemplate, listTemplates } from './registry';
export type { Template, TemplateContent, TemplateHandle } from './registry';
