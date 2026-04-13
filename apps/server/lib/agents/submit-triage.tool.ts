/**
 * submit_triage — the custom tool the Code Triage Gnome calls exactly
 * once to deliver its scouting report. Mirrors the pattern of
 * submit_code_analysis.tool.ts but with a much smaller schema: the
 * triage pass should finish in <30s with ~1-2k tokens of output, not
 * a 25k-token deep analysis.
 *
 * Schema tracks packages/shared-types/src/triage.ts.
 *
 * IMPORTANT: no `additionalProperties` anywhere — the beta rejects
 * schemas that declare it.
 */

export const SUBMIT_TRIAGE_TOOL_NAME = 'submit_triage';

export const SUBMIT_TRIAGE_TOOL = {
  name: SUBMIT_TRIAGE_TOOL_NAME,
  description:
    'Submit your repo triage report. Call this once after scouting the ' +
    'repo (tree walk + manifest files + top READMEs only — no deep file ' +
    'reads). The payload is used to let the user pick a focus for the ' +
    'deep analysis pass.',
  input_schema: {
    type: 'object',
    required: [
      'repoUrl',
      'totalFiles',
      'approxLines',
      'languages',
      'entryPoints',
      'subsystems',
    ],
    properties: {
      repoUrl: { type: 'string' },
      totalFiles: { type: 'integer' },
      approxLines: { type: 'integer' },
      languages: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'share'],
          properties: {
            name: { type: 'string' },
            share: { type: 'number' },
          },
        },
      },
      framework: { type: 'string' },
      buildTool: { type: 'string' },
      workspaces: {
        type: 'array',
        items: { type: 'string' },
      },
      entryPoints: {
        type: 'array',
        items: {
          type: 'object',
          required: ['file', 'role'],
          properties: {
            file: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
      subsystems: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'paths', 'purpose'],
          properties: {
            name: { type: 'string' },
            paths: { type: 'array', items: { type: 'string' } },
            purpose: { type: 'string' },
            fileCount: { type: 'integer' },
            importance: { type: 'number' },
          },
        },
      },
      highlights: {
        type: 'array',
        items: { type: 'string' },
      },
      notes: { type: 'string' },
    },
  },
} as const;
