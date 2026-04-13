/**
 * Agent 2 — Producer/Director Messages API client.
 *
 * A thin wrapper around the Anthropic Messages API that:
 *   1. Sends the static system prompt + assembled user message
 *   2. Includes the submit_presentation_script tool
 *   3. Extracts the PresentationScript from the tool_use response
 *   4. Returns the typed result (or throws on failure)
 *
 * This is intentionally NOT a Managed Agent. Agent 2 is a single
 * Messages API round-trip — no session, no polling, no bash tools.
 * It's pure reasoning: analysis in, script out.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PresentationScript } from '@showboxes/shared-types';
import type { UserSettings } from '@showboxes/shared-types';
import type { AnalysisJSON } from '@showboxes/shared-types';

import { PRODUCER_SYSTEM_PROMPT } from './producer.system-prompt';
import { buildProducerUserMessage } from './producer.message';
import { SUBMIT_PRESENTATION_SCRIPT_TOOL } from './producer.tool-schema';

export interface ProduceScriptOptions {
  analysis: AnalysisJSON;
  settings: UserSettings;
  focusInstructions?: string;
  /** Override the default model. Default: claude-sonnet-4-5-20250514 */
  model?: string;
}

export interface ProduceScriptResult {
  script: PresentationScript;
  /** Usage stats from the API response. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

const DEFAULT_MODEL = 'claude-sonnet-4-5';

/**
 * Call the Messages API to produce a PresentationScript.
 *
 * Throws if:
 *  - The API call fails
 *  - The model doesn't call the tool
 *  - The tool input doesn't parse as PresentationScript
 */
export async function produceScript(
  opts: ProduceScriptOptions,
): Promise<ProduceScriptResult> {
  const client = new Anthropic();

  const userMessage = buildProducerUserMessage({
    analysis: opts.analysis,
    settings: opts.settings,
    focusInstructions: opts.focusInstructions,
  });

  const response = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: 16384,
    system: PRODUCER_SYSTEM_PROMPT,
    tools: [SUBMIT_PRESENTATION_SCRIPT_TOOL],
    // Force the model to use the tool (no free-text escape)
    tool_choice: { type: 'tool', name: 'submit_presentation_script' },
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  });

  // ── Extract the tool call ──────────────────────────────────────
  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolBlock) {
    throw new ProducerError(
      'NO_TOOL_CALL',
      'Agent 2 did not call submit_presentation_script. ' +
        `Stop reason: ${response.stop_reason}`,
    );
  }

  if (toolBlock.name !== 'submit_presentation_script') {
    throw new ProducerError(
      'WRONG_TOOL',
      `Agent 2 called "${toolBlock.name}" instead of submit_presentation_script.`,
    );
  }

  // The tool input IS the PresentationScript (the schema enforces the shape).
  const script = toolBlock.input as unknown as PresentationScript;

  // ── Basic sanity checks ────────────────────────────────────────
  if (!script.meta?.title) {
    throw new ProducerError('INVALID_SCRIPT', 'Script is missing meta.title');
  }
  if (!Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new ProducerError('INVALID_SCRIPT', 'Script has no scenes');
  }

  return {
    script,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// ── Error class ──────────────────────────────────────────────────

export type ProducerErrorCode =
  | 'NO_TOOL_CALL'
  | 'WRONG_TOOL'
  | 'INVALID_SCRIPT'
  | 'API_ERROR';

export class ProducerError extends Error {
  constructor(
    public code: ProducerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProducerError';
  }
}
