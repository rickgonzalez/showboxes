/**
 * code_analysis provider — Phase 2 custom tool for structured analysis output.
 *
 * Single tool: `submit_code_analysis`. The gnome calls this once after
 * completing its analysis to deliver structured JSON that downstream
 * consumers (a Presenter Gnome, a web UI, a report generator) can
 * process without parsing prose.
 *
 * The session pauses on `requires_action` when this tool is called,
 * exactly like `marymary_submit_plan`. The server-side dispatcher
 * stores the structured analysis data and resolves the tool call.
 *
 * No credentials needed. Belongs to the `code_analysis` provider so
 * only gnomes with `code_analysis` in their `toolProviders` get it.
 *
 * NOTE: Before wiring this, add "code_analysis" to the ToolProviderType
 * union in `agents/types.ts`.
 */

import { registerPlatformTool } from "../registry";

/**
 * The analysis output schema. This is the contract between the analysis
 * gnome and anything downstream that consumes its output (presentation
 * gnome, web UI, export pipeline).
 *
 * IMPORTANT: no `additionalProperties` at any depth — the Managed
 * Agents beta rejects custom tool schemas that declare it.
 */
export const CODE_ANALYSIS_SCHEMA = {
  type: "object",
  required: ["quickFacts", "architecture", "codeQuality", "plainEnglish", "health"],
  properties: {
    quickFacts: {
      type: "object",
      required: ["repoUrl", "languages", "framework", "totalFiles", "totalLines"],
      properties: {
        repoUrl: {
          type: "string",
          description: "The GitHub repo URL that was analyzed.",
        },
        languages: {
          type: "array",
          items: { type: "string" },
          description:
            "Primary languages found, ordered by prevalence (e.g. ['TypeScript', 'CSS', 'SQL']).",
        },
        framework: {
          type: "string",
          description:
            "Primary framework or runtime (e.g. 'Next.js 14', 'FastAPI', 'Rails 7').",
        },
        buildTool: {
          type: "string",
          description: "Build/bundler tool (e.g. 'Vite', 'Webpack', 'Cargo').",
        },
        totalFiles: {
          type: "integer",
          description: "Total source files (excluding node_modules, .git, etc.).",
        },
        totalLines: {
          type: "integer",
          description: "Approximate total lines of source code.",
        },
        notableDependencies: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "purpose"],
            properties: {
              name: { type: "string" },
              purpose: {
                type: "string",
                description: "One-sentence description of what this dep does in the project.",
              },
            },
          },
          description: "Key dependencies worth knowing about (limit to ~10 most significant).",
        },
      },
    },

    architecture: {
      type: "object",
      required: ["summary", "entryPoints", "modules", "dataFlow"],
      properties: {
        summary: {
          type: "string",
          description:
            "2-3 sentence architectural summary. What pattern does this codebase follow?",
        },
        entryPoints: {
          type: "array",
          items: {
            type: "object",
            required: ["file", "role"],
            properties: {
              file: { type: "string", description: "File path relative to repo root." },
              role: {
                type: "string",
                description:
                  "What this entry point does (e.g. 'HTTP server startup', 'CLI entry', 'worker process').",
              },
            },
          },
          description: "Where execution begins — the front doors of the application.",
        },
        modules: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "path", "responsibility", "dependsOn"],
            properties: {
              name: {
                type: "string",
                description: "Human-readable module name (e.g. 'Authentication', 'Data Layer').",
              },
              path: { type: "string", description: "Directory or file path." },
              responsibility: {
                type: "string",
                description: "One sentence: what does this module own?",
              },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "Names of other modules this one imports from or calls.",
              },
            },
          },
          description: "Major organizational units in the codebase.",
        },
        dataFlow: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "steps"],
            properties: {
              name: {
                type: "string",
                description:
                  "Name of the flow (e.g. 'User signup', 'Payment processing', 'Data ingest').",
              },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  required: ["actor", "action"],
                  properties: {
                    actor: {
                      type: "string",
                      description:
                        "Who/what performs this step (module name, external service, user).",
                    },
                    action: {
                      type: "string",
                      description: "What happens at this step.",
                    },
                    file: {
                      type: "string",
                      description: "Relevant file path, if applicable.",
                    },
                  },
                },
              },
            },
          },
          description:
            "Key data flows traced through the system. Pick the 2-4 most important user journeys or data paths.",
        },
        diagram: {
          type: "string",
          description:
            "Optional text-based architecture diagram (ASCII, Mermaid, or similar). " +
            "Should show module relationships and data flow at a glance.",
        },
        externalIntegrations: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "purpose"],
            properties: {
              name: { type: "string", description: "Service or API name." },
              purpose: { type: "string", description: "Why the app talks to this." },
              credentialManagement: {
                type: "string",
                description: "How credentials are handled (env vars, secrets manager, hardcoded, etc.).",
              },
            },
          },
        },
      },
    },

    codeQuality: {
      type: "object",
      required: ["overallGrade", "patterns", "complexityHotspots", "techDebt", "strengths"],
      properties: {
        overallGrade: {
          type: "string",
          enum: ["A", "B", "C", "D", "F"],
          description:
            "Letter grade. A = production-ready, well-structured. " +
            "B = solid with minor issues. C = functional but significant debt. " +
            "D = fragile, needs major refactoring. F = critical issues.",
        },
        patterns: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "assessment"],
            properties: {
              name: {
                type: "string",
                description: "Pattern area (e.g. 'Error handling', 'Naming', 'Testing').",
              },
              assessment: {
                type: "string",
                description: "What you found — be specific with file references.",
              },
              grade: {
                type: "string",
                enum: ["good", "mixed", "poor"],
              },
            },
          },
        },
        complexityHotspots: {
          type: "array",
          items: {
            type: "object",
            required: ["file", "issue", "severity"],
            properties: {
              file: { type: "string" },
              lineRange: { type: "string", description: "e.g. '45-120'" },
              issue: { type: "string", description: "What makes this complex." },
              severity: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
              },
              suggestion: {
                type: "string",
                description: "How to improve it.",
              },
            },
          },
        },
        techDebt: {
          type: "array",
          items: {
            type: "object",
            required: ["description", "impact"],
            properties: {
              description: { type: "string" },
              file: { type: "string" },
              impact: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "How much this slows development or risks breakage.",
              },
            },
          },
        },
        securityConcerns: {
          type: "array",
          items: {
            type: "object",
            required: ["description", "severity"],
            properties: {
              description: { type: "string" },
              file: { type: "string" },
              severity: {
                type: "string",
                enum: ["info", "warning", "critical"],
              },
              remediation: { type: "string" },
            },
          },
        },
        strengths: {
          type: "array",
          items: {
            type: "object",
            required: ["description"],
            properties: {
              description: { type: "string" },
              file: { type: "string" },
            },
          },
          description:
            "What the creator did well. Always include at least one — there is always something.",
        },
      },
    },

    plainEnglish: {
      type: "object",
      required: ["oneLiner", "fullExplanation", "userJourneys"],
      properties: {
        oneLiner: {
          type: "string",
          description:
            "One sentence a non-developer could understand: what does this app do?",
        },
        fullExplanation: {
          type: "string",
          description:
            "3-5 paragraph explanation using analogies, actor names, and behavior " +
            "descriptions. No code syntax, no jargon. Written for someone who " +
            "understands what software does in general but not how.",
        },
        userJourneys: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "narrative"],
            properties: {
              name: {
                type: "string",
                description: "Journey name (e.g. 'Signing up', 'Making a purchase').",
              },
              narrative: {
                type: "string",
                description:
                  "End-to-end walkthrough in plain English. What the user does, " +
                  "what the app does behind the scenes, what the user sees.",
              },
            },
          },
          description: "The 2-3 most important things a user does with the application.",
        },
        analogies: {
          type: "array",
          items: {
            type: "object",
            required: ["concept", "analogy"],
            properties: {
              concept: {
                type: "string",
                description: "The technical concept being explained.",
              },
              analogy: {
                type: "string",
                description: "The non-technical analogy or metaphor.",
              },
            },
          },
          description: "Key analogies used to explain technical concepts.",
        },
      },
    },

    health: {
      type: "object",
      required: ["verdict", "topRisks", "topWins", "readingOrder"],
      properties: {
        verdict: {
          type: "string",
          description:
            "One paragraph: is this codebase in good shape, rough shape, or somewhere in between? Honest.",
        },
        topRisks: {
          type: "array",
          items: {
            type: "object",
            required: ["risk", "consequence"],
            properties: {
              risk: { type: "string" },
              consequence: {
                type: "string",
                description: "What happens if this isn't addressed.",
              },
            },
          },
          description: "Top 3 risks if the codebase continues on its current trajectory.",
        },
        topWins: {
          type: "array",
          items: {
            type: "object",
            required: ["improvement", "impact"],
            properties: {
              improvement: { type: "string" },
              impact: {
                type: "string",
                description: "Why this would make a big difference.",
              },
              effort: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
            },
          },
          description: "Top 3 highest-leverage improvements.",
        },
        readingOrder: {
          type: "array",
          items: {
            type: "object",
            required: ["file", "why"],
            properties: {
              file: { type: "string" },
              why: {
                type: "string",
                description: "One sentence: why read this file at this point in the sequence.",
              },
            },
          },
          description:
            "The ideal reading order for someone trying to understand this codebase. 5-10 files.",
        },
      },
    },
  },
} as const;

registerPlatformTool({
  name: "submit_code_analysis",
  description:
    "Submit your completed code analysis for review. The `data` object MUST " +
    "conform to the analysis schema: quickFacts, architecture, codeQuality, " +
    "plainEnglish, and health sections. The session will pause until the " +
    "reviewer accepts or sends back feedback. Do your analysis work first, " +
    "then call this tool exactly once with the structured result.",
  inputSchema: CODE_ANALYSIS_SCHEMA,
  requiredSources: [],
  hasSideEffects: false,
  provider: "code_analysis" as any, // Cast until ToolProviderType union is updated
  execute: async (input, ctx) => {
    // Phase 2: the dispatcher will store this structured analysis data
    // on the TaskExecution row (same pattern as submit_work_product).
    // For now, return acknowledgment so the agent knows it was received.
    return {
      accepted: true,
      message: "Code analysis received. Awaiting review.",
    };
  },
});
