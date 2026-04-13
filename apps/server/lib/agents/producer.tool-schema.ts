/**
 * Agent 2 — submit_presentation_script tool schema.
 *
 * This is the JSON Schema passed as a tool definition in the Messages
 * API call. It forces the model to return a valid PresentationScript
 * via tool_use rather than free-text. The schema mirrors the shared
 * PresentationScript type but is expressed as JSON Schema for the API.
 *
 * Why tool_use instead of response_format?
 *   - tool_use gives us structured output with a schema contract
 *   - The model calls the tool exactly once; we harvest the input
 *   - It matches the pattern Agent 1 uses (submit_code_analysis)
 *   - We can add validation/retry logic around the tool call
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * The tool definition for the Messages API. Pass this in the `tools`
 * array of the messages.create() call.
 */
export const SUBMIT_PRESENTATION_SCRIPT_TOOL: Tool = {
  name: 'submit_presentation_script',
  description:
    'Submit the complete PresentationScript. Call this exactly once with ' +
    'the full script including meta, defaults, and all scenes. The script ' +
    'will be validated and passed to the player for rendering.',
  input_schema: {
    type: 'object' as const,
    required: ['meta', 'defaults', 'scenes'],
    properties: {
      meta: {
        type: 'object' as const,
        required: ['title', 'repoUrl', 'generatedAt', 'persona', 'estimatedDuration'],
        properties: {
          title: { type: 'string' as const, description: 'Presentation title' },
          repoUrl: { type: 'string' as const, description: 'Repository URL from analysis' },
          generatedAt: { type: 'string' as const, description: 'ISO 8601 timestamp' },
          persona: {
            type: 'string' as const,
            enum: ['corporate', 'character', 'friendly', 'stern'],
            description: 'Presentation persona',
          },
          estimatedDuration: {
            type: 'number' as const,
            description: 'Total estimated duration in seconds',
          },
        },
      },
      defaults: {
        type: 'object' as const,
        required: ['palette', 'transition', 'voice'],
        properties: {
          palette: {
            type: 'object' as const,
            required: ['primary', 'secondary', 'accent', 'background', 'text', 'code'],
            properties: {
              primary: { type: 'string' as const },
              secondary: { type: 'string' as const },
              accent: { type: 'string' as const },
              background: { type: 'string' as const },
              text: { type: 'string' as const },
              code: { type: 'string' as const },
            },
          },
          transition: {
            type: 'object' as const,
            required: ['type', 'durationMs'],
            properties: {
              type: {
                type: 'string' as const,
                enum: ['cut', 'fade', 'slide-left', 'slide-right', 'zoom-in', 'dissolve'],
              },
              durationMs: { type: 'number' as const },
            },
          },
          voice: {
            type: 'object' as const,
            required: ['provider', 'voiceId', 'speed'],
            properties: {
              provider: {
                type: 'string' as const,
                enum: ['elevenlabs', 'kokoro', 'stub'],
              },
              voiceId: { type: 'string' as const },
              speed: { type: 'number' as const },
            },
          },
        },
      },
      scenes: {
        type: 'array' as const,
        description: 'Ordered list of scenes in the presentation',
        items: {
          type: 'object' as const,
          required: ['id', 'section', 'primitive', 'narration', 'holdSeconds'],
          properties: {
            id: {
              type: 'string' as const,
              description: 'Unique scene id (e.g. "s01-title")',
            },
            section: {
              type: 'string' as const,
              enum: ['quickFacts', 'architecture', 'codeQuality', 'plainEnglish', 'health'],
              description: 'Which analysis section this scene covers',
            },
            primitive: {
              type: 'object' as const,
              required: ['template', 'content'],
              properties: {
                template: {
                  type: 'string' as const,
                  enum: [
                    'title-bullets',
                    'emphasis-word',
                    'code-zoom',
                    'code-cloud',
                    'purpose-bullets',
                    'center-stage',
                    'flow-diagram',
                    'sequence-diagram',
                    'transform-grid',
                    'step-journey',
                    'data-pipeline',
                    'scorecard',
                    'entity-map',
                  ],
                  description: 'Visual template to render',
                },
                content: {
                  type: 'object' as const,
                  description:
                    'Template-specific content slots. Shape depends on the template chosen. ' +
                    'Refer to the Visual Primitives Catalog in the system prompt.',
                },
              },
            },
            narration: {
              type: 'string' as const,
              description: 'Spoken narration text for this scene. No markdown or formatting.',
            },
            holdSeconds: {
              type: 'number' as const,
              description: 'Minimum seconds to display the scene (must cover narration duration)',
            },
            transition: {
              type: 'object' as const,
              description: 'Optional per-scene transition override',
              properties: {
                type: {
                  type: 'string' as const,
                  enum: ['cut', 'fade', 'slide-left', 'slide-right', 'zoom-in', 'dissolve'],
                },
                durationMs: { type: 'number' as const },
              },
            },
            beats: {
              type: 'array' as const,
              description: 'Timed actions synchronized with narration',
              items: {
                type: 'object' as const,
                required: ['at', 'action'],
                properties: {
                  at: {
                    type: 'number' as const,
                    description: 'Seconds after scene start to fire this beat',
                  },
                  action: {
                    type: 'object' as const,
                    required: ['type'],
                    description:
                      'Beat action. Types: "emphasize" (target: string), ' +
                      '"highlight-line" (line: number), "reveal" (index: number), ' +
                      '"annotate" (text: string, position: top|bottom|left|right), ' +
                      '"fx" (name: string, params?: object)',
                    properties: {
                      type: {
                        type: 'string' as const,
                        enum: ['emphasize', 'highlight-line', 'reveal', 'annotate', 'fx'],
                      },
                      target: { type: 'string' as const },
                      line: { type: 'number' as const },
                      index: { type: 'number' as const },
                      text: { type: 'string' as const },
                      position: {
                        type: 'string' as const,
                        enum: ['top', 'bottom', 'left', 'right'],
                      },
                      name: { type: 'string' as const },
                      params: { type: 'object' as const },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
