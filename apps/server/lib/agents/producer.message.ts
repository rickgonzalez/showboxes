/**
 * Agent 2 — Producer/Director user message builder.
 *
 * Assembles the user-turn content for the Messages API call. No
 * Handlebars — just structured data the model reasons over. The user
 * message has three sections:
 *
 *   1. The analysis JSON (from Agent 1)
 *   2. The user settings (audience, detail, pace, persona, voice)
 *   3. Optional focus instructions (e.g. "emphasize security findings")
 *
 * The model interprets the settings directly. A detailLevel of 0.3
 * means "keep it brief" — the model reads the number and the system
 * prompt's guidelines to decide how many scenes to produce. We don't
 * pre-render different instruction variants.
 */

import type { AnalysisJSON } from '@showboxes/shared-types';
import type { UserSettings } from '@showboxes/shared-types';

export interface ProducerMessageContext {
  analysis: AnalysisJSON;
  settings: UserSettings;
  /** Optional free-text instructions, e.g. "focus on the payment flow" */
  focusInstructions?: string;
}

/**
 * Build the user message content block for the Messages API call.
 *
 * The message is structured as labeled sections so the model can parse
 * it cleanly. The analysis is included as a fenced JSON block — models
 * handle this better than deeply nested inline JSON.
 */
export function buildProducerUserMessage(ctx: ProducerMessageContext): string {
  const parts: string[] = [];

  // ── Section 1: Analysis ──────────────────────────────────────
  parts.push('## Code Analysis\n');
  parts.push('The following is the complete analysis produced by the Code Analysis Gnome.\n');
  parts.push('```json');
  parts.push(JSON.stringify(ctx.analysis, null, 2));
  parts.push('```\n');

  // ── Section 2: User Settings ─────────────────────────────────
  parts.push('## Presentation Settings\n');
  parts.push(`- **Audience level:** ${ctx.settings.audienceLevel} ${audienceHint(ctx.settings.audienceLevel)}`);
  parts.push(`- **Detail level:** ${ctx.settings.detailLevel} ${detailHint(ctx.settings.detailLevel)}`);
  parts.push(`- **Pace:** ${ctx.settings.pace} ${paceHint(ctx.settings.pace)}`);
  parts.push(`- **Persona:** ${ctx.settings.persona}`);
  parts.push(`- **Voice:** provider=${ctx.settings.voice.provider}, voiceId=${ctx.settings.voice.voiceId}, speed=${ctx.settings.voice.speed}`);

  if (ctx.settings.focusAreas && ctx.settings.focusAreas.length > 0) {
    parts.push(`- **Focus areas:** ${ctx.settings.focusAreas.join(', ')}`);
  }

  parts.push('');

  // ── Section 3: Focus Instructions (optional) ─────────────────
  if (ctx.focusInstructions) {
    parts.push('## Additional Instructions\n');
    parts.push(ctx.focusInstructions);
    parts.push('');
  }

  // ── Final instruction ────────────────────────────────────────
  parts.push('## Your Task\n');
  parts.push(
    'Produce a PresentationScript for this codebase by calling the `submit_presentation_script` tool exactly once. ' +
    'Follow the guidelines in your system prompt for scene count, narration style, template selection, and beat choreography. ' +
    'Match the audience level, detail level, pace, and persona specified above.',
  );

  return parts.join('\n');
}

// ── Inline hints ──────────────────────────────────────────────────
// These short parenthetical hints help the model calibrate without us
// needing to pre-render different prompt variants. The model sees both
// the number AND the human-readable hint.

function audienceHint(level: number): string {
  if (level <= 0.2) return '(non-technical — use analogies, avoid jargon)';
  if (level <= 0.4) return '(somewhat technical — light jargon OK, explain patterns)';
  if (level <= 0.6) return '(technical — comfortable with code and architecture)';
  if (level <= 0.8) return '(senior developer — show code, name patterns)';
  return '(expert — dense, precise, skip basics)';
}

function detailHint(level: number): string {
  if (level <= 0.2) return '(executive summary — 4–6 scenes)';
  if (level <= 0.5) return '(standard walkthrough — 8–12 scenes)';
  if (level <= 0.8) return '(detailed review — 12–18 scenes)';
  return '(comprehensive deep dive — 18–25 scenes)';
}

function paceHint(pace: number): string {
  if (pace <= 0.2) return '(very slow — generous holds, one idea per scene)';
  if (pace <= 0.4) return '(relaxed — comfortable pacing)';
  if (pace <= 0.6) return '(moderate — steady flow)';
  if (pace <= 0.8) return '(brisk — compact narration, shorter holds)';
  return '(fast — dense, minimal pauses)';
}
