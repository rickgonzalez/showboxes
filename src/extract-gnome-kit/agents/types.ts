// Core types for the agentic task system

import type { TacticCategory, MetricSource, Task, Tactic, Project } from "@prisma/client";
import type { JsonSchema, PreviousWorkProduct } from "@/workproducts/types";

// ── Agent Definitions ─────────────────────────────────────

/**
 * An AgentDefinition describes the capabilities and behavior
 * of an agent for a specific tactic category.
 */
export interface AgentDefinition {
  /** Unique identifier for this agent type */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which tactic categories this agent handles */
  categories: TacticCategory[];
  /** Description of what this agent does */
  description: string;
  /** Default model to use */
  defaultModel: string;
  /** System prompt template — receives context at runtime */
  buildSystemPrompt: (context: AgentContext) => string;
  /** Which tool providers this agent can use */
  toolProviders: ToolProviderType[];
  /** Maximum tokens for plan generation */
  maxPlanTokens: number;
  /** Maximum tokens for execution */
  maxExecuteTokens: number;
  /** Whether this agent's tasks can skip approval (e.g. read-only monitoring) */
  canAutoExecute: boolean;
  /** Work product type slugs this agent can produce. Empty = no typed work products. */
  producibleWorkProducts?: string[];
  /** Optional suffix appended to the plan generation prompt.
   *  Used by gnomes that need special plan instructions (e.g. research gnome
   *  needs URLs in plan steps for pre-fetching). */
  planPromptSuffix?: string;
  /** Optional custom execution function that bypasses the default multi-turn loop.
   *  When defined, executePlan() calls this instead of callLLMForExecution(). */
  executeOverride?: (
    agentDef: AgentDefinition,
    context: AgentContext,
    plan: ExecutionPlan,
    organizationId: string,
  ) => Promise<ExecutionResult>;
}

// ── Agent Context ─────────────────────────────────────────

/**
 * Runtime context passed to an agent when it plans or executes.
 * Everything the agent needs to understand the task.
 */
export interface AgentContext {
  task: Task;
  tactic: Tactic & { project: Project };
  /** Recent metrics for this tactic */
  recentMetrics: Array<{
    source: MetricSource;
    metric: string;
    value: number;
    unit?: string | null;
    recordedAt: Date;
  }>;
  /** Available tools resolved from MetricsConfig + agent definition */
  availableTools: ResolvedTool[];
  /** Previous executions for this task (for retry context) */
  previousExecutions: Array<{
    id: string;
    status: string;
    outputText?: string | null;
    error?: string | null;
  }>;
  /** Project knowledge base — brand voice, product briefs, guidelines, etc. */
  knowledgeBlock: string;
  /** Agent config overrides from the task */
  configOverrides?: Record<string, unknown>;

  // ── Work Product Context (Phase 1+) ──

  /**
   * JSON Schema for the target work product type, if this execution
   * produces a typed artifact. Included so the agent knows what
   * structured output to generate during PRODUCING phase.
   */
  targetWorkProductSchema?: JsonSchema;

  /**
   * Previous work product version + reviewer feedback, populated
   * during revision loops (REVISION_REQUESTED → PRODUCING).
   * The agent sees what it produced before and what needs to change.
   */
  previousWorkProduct?: PreviousWorkProduct;

  /** Work product slugs this agent can produce (from AgentDefinition) */
  producibleWorkProducts?: string[];

  /** Source work product from a "task bump" — prior research/content as context */
  sourceWorkProduct?: {
    id: string;
    definitionSlug: string;
    version: number;
    data: Record<string, unknown>;
    agentNotes?: string | null;
    sourceTaskTitle: string;
  };

  /** Current execution metadata (IDs surfaced to gnome templates) */
  execution?: {
    id: string;
    workProductType?: string | null;
  };
}

// ── Tool System ───────────────────────────────────────────

// Phase 5 (Managed Agents migration) narrowed this union from 16 entries to
// 9. Removed:
//   - youtube, tiktok, reddit, email, plausible — phantom providers, never
//     had any implementation. Were prompt fiction in some gnome defaults.
//   - content_generation, data_analysis — pure-LLM helpers; the LLM does the
//     work itself, no tool needed. Removing them frees up tool slots and
//     stops confusing the gnome about what's a real platform call.
// If you re-add a provider here, also register a corresponding `PlatformTool`
// in `src/agents/managed-agents/platform-tools/providers/` so the Managed
// Agents path knows how to dispatch it.
export type ToolProviderType =
  | "twitter"
  | "instagram"
  | "steam"
  | "app_store"
  | "google_analytics"
  | "discord"
  | "web_search"
  | "media_library"
  | "ai_image_generation";

/**
 * A tool definition in Anthropic's tool format, resolved at runtime
 * with credentials from MetricsConfig.
 */
export interface ResolvedTool {
  /** Tool name as sent to Claude */
  name: string;
  /** Description for Claude */
  description: string;
  /** JSON Schema for the input */
  input_schema: Record<string, unknown>;
  /** Which provider this tool comes from */
  provider: ToolProviderType;
  /** Whether this tool has side effects (write vs read) */
  hasSideEffects: boolean;
  /** The function to execute when Claude calls this tool */
  execute: (input: Record<string, unknown>, credentials?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * A ToolProvider registers tools for a specific platform/service.
 * Tools are resolved at runtime based on available MetricsConfig credentials.
 */
export interface ToolProvider {
  type: ToolProviderType;
  /** Which MetricSource(s) this provider needs credentials for */
  requiredSources: MetricSource[];
  /** Build the tools, given decrypted credentials */
  resolveTools: (credentials: Record<string, unknown>, meta?: Record<string, unknown>) => ResolvedTool[];
}

// ── Execution Plan ────────────────────────────────────────

export interface ExecutionPlan {
  summary: string;
  steps: PlannedStep[];
  estimatedDurationMs?: number;
  requiresApproval: boolean;
  reasoning?: string;
  /** The work product type slug the agent intends to produce (declared during planning) */
  workProductType?: string;
}

export interface PlannedStep {
  action: string;
  description: string;
  tool?: string;
  hasSideEffects: boolean;
  /** If true, this specific step needs approval even if the task is auto-execute */
  requiresApproval: boolean;
}

/**
 * JSON Schema mirror of `ExecutionPlan`. Used as the `input_schema` for the
 * Managed Agents `marymary_submit_plan` custom tool (Phase 3 migration).
 *
 * IMPORTANT: keep in sync with the `ExecutionPlan` and `PlannedStep` interfaces
 * above. There is no automatic conversion — when you change the interface,
 * change this constant too. The shape is small enough (6 top-level fields) that
 * a hand-written schema is cheaper than pulling in a zod-to-json-schema dep.
 */
export const EXECUTION_PLAN_JSON_SCHEMA = {
  type: "object",
  // NOTE: `additionalProperties` is intentionally omitted. The Managed Agents
  // beta rejects custom tool input schemas that declare it
  // ("tools.0.input_schema.additionalProperties: Extra inputs are not permitted").
  // We rely on the agent to respect `required` + documented properties.
  required: ["summary", "steps", "requiresApproval"],
  properties: {
    summary: {
      type: "string",
      description: "One- or two-sentence summary of the plan.",
    },
    reasoning: {
      type: "string",
      description: "Why this approach — optional, helpful for reviewers.",
    },
    requiresApproval: {
      type: "boolean",
      description:
        "Whether this plan must be reviewed by a human before execution. " +
        "Always true when this tool is exposed; auto-execute gnomes don't see it.",
    },
    estimatedDurationMs: {
      type: "integer",
      minimum: 0,
      description: "Rough wall-clock estimate in milliseconds.",
    },
    workProductType: {
      type: "string",
      description:
        "Slug of the work product type the agent intends to produce, if any " +
        "(e.g. 'linkedin-post'). May be omitted if pre-set by the caller.",
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        // additionalProperties intentionally omitted — see note above.
        required: ["action", "description", "hasSideEffects", "requiresApproval"],
        properties: {
          action: {
            type: "string",
            description: "Short verb-phrase identifier for the step.",
          },
          description: {
            type: "string",
            description: "Human-readable description of what this step does.",
          },
          tool: {
            type: "string",
            description: "Tool the step intends to use, if any.",
          },
          hasSideEffects: {
            type: "boolean",
            description: "True if the step writes to an external system.",
          },
          requiresApproval: {
            type: "boolean",
            description:
              "True if this specific step needs explicit approval even when " +
              "the task is auto-execute.",
          },
        },
      },
    },
  },
} as const;

/**
 * JSON Schema for the Phase 4 `marymary_submit_work_product` custom tool.
 * Generic on purpose: `data` is `type: "object"` so a single Agent version
 * can submit any work product type. The per-task schema travels through the
 * initial user message inside `buildInitialUserMessage` — keeping it out of
 * the tool's input_schema avoids per-task Agent version explosion.
 *
 * IMPORTANT: do NOT add `additionalProperties` (top-level OR nested under
 * `data`). The Managed Agents beta rejects custom tool input schemas that
 * declare it ("tools.0.input_schema.additionalProperties: Extra inputs are
 * not permitted"). The same gotcha bites EXECUTION_PLAN_JSON_SCHEMA above.
 */
export const WORK_PRODUCT_SUBMISSION_JSON_SCHEMA = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      description:
        "The work product payload. Must conform to the JSON Schema for the " +
        "target work product type, which was provided in the initial user " +
        "message under '── Work product specification ──'.",
    },
    notes: {
      type: "string",
      description:
        "Optional notes for the human reviewer — what was changed, what " +
        "tradeoffs you made, anything they should look at first.",
    },
  },
} as const;

// ── Execution Result ──────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  outputText: string;
  steps: StepResult[];
  telemetry: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    toolCalls: number;
  };
  /** Structured work product data extracted from agent output (if work product type was targeted) */
  workProductData?: Record<string, unknown>;
}

export interface StepResult {
  stepIndex: number;
  type: "TOOL_CALL" | "LLM_REASONING" | "CONTENT_GEN" | "DATA_FETCH" | "DECISION" | "REPORT" | "WORK_PRODUCT_CREATED" | "REVIEW_ACTION" | "DELIVERY_ATTEMPT";
  action: string;
  description?: string;
  tool?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  llmResponse?: string;
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  error?: string;
  durationMs?: number;
}
