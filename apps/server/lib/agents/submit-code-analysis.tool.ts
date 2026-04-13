/**
 * submit_code_analysis — the custom tool the Code Analysis Gnome calls
 * exactly once to deliver its structured output. The Managed Agents beta
 * surfaces this call as a `requires_action` event; our session poller
 * pulls the `input.data` payload, validates it as AnalysisJSON, and
 * resolves the tool call.
 *
 * Schema ported verbatim from:
 *   reference/gnome-kit/agents/managed-agents/platform-tools/providers/code-analysis.ts
 *
 * IMPORTANT: no `additionalProperties` anywhere — the beta rejects schemas
 * that declare it.
 */

export const SUBMIT_CODE_ANALYSIS_TOOL_NAME = 'submit_code_analysis';

export const SUBMIT_CODE_ANALYSIS_TOOL = {
  name: SUBMIT_CODE_ANALYSIS_TOOL_NAME,
  description:
    'Submit your completed code analysis. The payload MUST conform to the ' +
    'schema: quickFacts, architecture, codeQuality, plainEnglish, and health ' +
    'sections. Call this tool exactly once at the end of your analysis.',
  input_schema: {
    type: 'object',
    required: ['quickFacts', 'architecture', 'codeQuality', 'plainEnglish', 'health'],
    properties: {
      quickFacts: {
        type: 'object',
        required: ['repoUrl', 'languages', 'framework', 'totalFiles', 'totalLines'],
        properties: {
          repoUrl: { type: 'string' },
          languages: { type: 'array', items: { type: 'string' } },
          framework: { type: 'string' },
          buildTool: { type: 'string' },
          totalFiles: { type: 'integer' },
          totalLines: { type: 'integer' },
          notableDependencies: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'purpose'],
              properties: {
                name: { type: 'string' },
                purpose: { type: 'string' },
              },
            },
          },
        },
      },

      architecture: {
        type: 'object',
        required: ['summary', 'entryPoints', 'modules', 'dataFlow'],
        properties: {
          summary: { type: 'string' },
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
          modules: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'path', 'responsibility', 'dependsOn'],
              properties: {
                name: { type: 'string' },
                path: { type: 'string' },
                responsibility: { type: 'string' },
                dependsOn: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          dataFlow: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'steps'],
              properties: {
                name: { type: 'string' },
                steps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['actor', 'action'],
                    properties: {
                      actor: { type: 'string' },
                      action: { type: 'string' },
                      file: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          diagram: { type: 'string' },
          externalIntegrations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'purpose'],
              properties: {
                name: { type: 'string' },
                purpose: { type: 'string' },
                credentialManagement: { type: 'string' },
              },
            },
          },
        },
      },

      codeQuality: {
        type: 'object',
        required: ['overallGrade', 'patterns', 'complexityHotspots', 'techDebt', 'strengths'],
        properties: {
          overallGrade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
          patterns: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'assessment'],
              properties: {
                name: { type: 'string' },
                assessment: { type: 'string' },
                grade: { type: 'string', enum: ['good', 'mixed', 'poor'] },
              },
            },
          },
          complexityHotspots: {
            type: 'array',
            items: {
              type: 'object',
              required: ['file', 'issue', 'severity'],
              properties: {
                file: { type: 'string' },
                lineRange: { type: 'string' },
                issue: { type: 'string' },
                severity: {
                  type: 'string',
                  enum: ['low', 'medium', 'high', 'critical'],
                },
                suggestion: { type: 'string' },
              },
            },
          },
          techDebt: {
            type: 'array',
            items: {
              type: 'object',
              required: ['description', 'impact'],
              properties: {
                description: { type: 'string' },
                file: { type: 'string' },
                impact: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
            },
          },
          securityConcerns: {
            type: 'array',
            items: {
              type: 'object',
              required: ['description', 'severity'],
              properties: {
                description: { type: 'string' },
                file: { type: 'string' },
                severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                remediation: { type: 'string' },
              },
            },
          },
          strengths: {
            type: 'array',
            items: {
              type: 'object',
              required: ['description'],
              properties: {
                description: { type: 'string' },
                file: { type: 'string' },
              },
            },
          },
        },
      },

      plainEnglish: {
        type: 'object',
        required: ['oneLiner', 'fullExplanation', 'userJourneys'],
        properties: {
          oneLiner: { type: 'string' },
          fullExplanation: { type: 'string' },
          userJourneys: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'narrative'],
              properties: {
                name: { type: 'string' },
                narrative: { type: 'string' },
              },
            },
          },
          analogies: {
            type: 'array',
            items: {
              type: 'object',
              required: ['concept', 'analogy'],
              properties: {
                concept: { type: 'string' },
                analogy: { type: 'string' },
              },
            },
          },
        },
      },

      health: {
        type: 'object',
        required: ['verdict', 'topRisks', 'topWins', 'readingOrder'],
        properties: {
          verdict: { type: 'string' },
          topRisks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['risk', 'consequence'],
              properties: {
                risk: { type: 'string' },
                consequence: { type: 'string' },
              },
            },
          },
          topWins: {
            type: 'array',
            items: {
              type: 'object',
              required: ['improvement', 'impact'],
              properties: {
                improvement: { type: 'string' },
                impact: { type: 'string' },
                effort: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
            },
          },
          readingOrder: {
            type: 'array',
            items: {
              type: 'object',
              required: ['file', 'why'],
              properties: {
                file: { type: 'string' },
                why: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;
