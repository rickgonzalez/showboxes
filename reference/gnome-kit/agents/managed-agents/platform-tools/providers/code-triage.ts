/**
 * code_triage provider — Phase 2 custom tool for structured triage output.
 *
 * Single tool: `submit_triage`. The triage gnome calls this once at the
 * end of its scouting pass to deliver a small TriageReport. Downstream,
 * the UI offers the user a focus choice (overview / deep-dive /
 * scorecard / walkthrough) which is then forwarded to the deeper
 * code-analysis gnome.
 *
 * NOTE: Before wiring this, add "code_triage" to the ToolProviderType
 * union in `agents/types.ts`.
 */

import { registerPlatformTool } from "../registry";

export const CODE_TRIAGE_SCHEMA = {
  type: "object",
  required: [
    "repoUrl",
    "totalFiles",
    "approxLines",
    "languages",
    "entryPoints",
    "subsystems",
  ],
  properties: {
    repoUrl: { type: "string" },
    totalFiles: { type: "integer" },
    approxLines: { type: "integer" },
    languages: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "share"],
        properties: {
          name: { type: "string" },
          share: {
            type: "number",
            description: "Rough share of the codebase, 0-1. Shares across all entries should sum to ~1.",
          },
        },
      },
    },
    framework: { type: "string" },
    buildTool: { type: "string" },
    workspaces: {
      type: "array",
      items: { type: "string" },
      description: "Monorepo workspace roots, if any (e.g. apps/*, packages/*).",
    },
    entryPoints: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "role"],
        properties: {
          file: { type: "string" },
          role: { type: "string" },
        },
      },
    },
    subsystems: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "paths", "purpose"],
        properties: {
          name: { type: "string", description: "Human-readable name (e.g. 'Authentication')." },
          paths: { type: "array", items: { type: "string" } },
          purpose: { type: "string", description: "One-sentence guess at what this subsystem does." },
          fileCount: { type: "integer" },
          importance: {
            type: "number",
            description: "How central this looks to the app (0-1). Drives default selection in the UI.",
          },
        },
      },
    },
    highlights: {
      type: "array",
      items: { type: "string" },
      description: "1-3 noteworthy observations up front.",
    },
    notes: {
      type: "string",
      description: "If triage hit a wall (too large, clone failed, etc.), explain here.",
    },
  },
} as const;

registerPlatformTool({
  name: "submit_triage",
  description:
    "Submit your completed repo triage. The payload MUST conform to the " +
    "triage schema. Call this once at the end of your scouting pass — " +
    "tree + manifests only, no deep source reads.",
  inputSchema: CODE_TRIAGE_SCHEMA,
  requiredSources: [],
  hasSideEffects: false,
  provider: "code_triage" as any, // Cast until ToolProviderType union is updated
  execute: async (input, ctx) => {
    return {
      accepted: true,
      message: "Triage received.",
    };
  },
});
