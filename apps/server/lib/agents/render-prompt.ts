import Handlebars from 'handlebars';
import type { AnalysisMode } from '@showboxes/shared-types';
import type { AnalysisPromptContext } from './code-analysis.gnome';

/**
 * Render the code-analysis gnome's system prompt against a per-run context.
 * The template is Handlebars with a small variable surface: repoUrl,
 * optional focusAreas / priorityPaths, and an optional `modeDirective`
 * paragraph that steers scope when the user picked a mode after triage.
 */
export function renderCodeAnalysisPrompt(
  template: string,
  ctx: AnalysisPromptContext,
): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled({
    repoUrl: ctx.repoUrl,
    focusAreas:
      ctx.focusAreas && ctx.focusAreas.length > 0
        ? ctx.focusAreas.join(', ')
        : undefined,
    priorityPaths:
      ctx.priorityPaths && ctx.priorityPaths.length > 0
        ? ctx.priorityPaths.join(', ')
        : undefined,
    modeDirective: ctx.mode ? renderModeDirective(ctx.mode) : undefined,
  });
}

/**
 * Convert a chosen AnalysisMode into a paragraph the agent reads as part
 * of its system prompt. The agent's full schema output contract does not
 * change — modes steer depth/breadth, not structure. Sections the user
 * didn't ask for can be summarized briefly rather than exhaustively.
 */
function renderModeDirective(mode: AnalysisMode): string {
  switch (mode.kind) {
    case 'overview':
      return [
        'Produce a HIGH-LEVEL OVERVIEW. Cap your exploration to ~30 files total:',
        'top-level entries, each subsystem\'s main file, and the most important',
        'shared utilities. Keep every section concise. Favor breadth over depth.',
        'The reader wants a tour, not a deep inspection.',
      ].join(' ');

    case 'deep-dive':
      return [
        `DEEP DIVE on: ${mode.subsystems.join(', ')}.`,
        'Spend most of your exploration budget inside these subsystems — read',
        'their source thoroughly, trace flows end-to-end, and produce detailed',
        'findings. Other areas should be covered briefly, just enough to situate',
        'the deep-dive subsystems in the wider codebase.',
      ].join(' ');

    case 'scorecard':
      return [
        'Produce a SCORECARD-STYLE analysis. Prioritize codeQuality and health',
        'sections: letter grade, patterns, complexity hotspots, tech debt,',
        'security, strengths, top risks, top wins. Keep architecture and',
        'plainEnglish sections short (one paragraph each). The reader wants',
        'to know "is this repo any good and what should we fix first?"',
      ].join(' ');

    case 'walkthrough':
      return [
        `GUIDED WALKTHROUGH centered on entry point: ${mode.entryPoint}.`,
        'Trace this entry point end-to-end as one richly detailed user journey',
        'in the plainEnglish.userJourneys section. Architecture section should',
        'emphasize the modules and data flow this entry point touches. Keep',
        'unrelated areas brief.',
      ].join(' ');
  }
}
