/**
 * Managed Agents session service — Phase 2 of the migration.
 *
 * Parallel execution path to `agent.service.ts:executePlan`. When the feature
 * flag is on (`MARYMARY_MANAGED_AGENTS_ENABLED=true` AND
 * `Project.enableManagedAgents=true`), the execute route calls into this
 * module instead of the legacy 20-turn loop.
 *
 * Responsibilities:
 *   1. Open a Managed Agents `Session` against the gnome's remote `Agent`.
 *   2. Send the approved plan + agent context as the initial `user.message`.
 *   3. Poll `/v1/sessions/{id}/events` and project events into
 *      `ExecutionStep` rows so the existing UI renders without changes.
 *   4. Mirror `session.usage` into `TaskExecution.{input,output,total}Tokens`
 *      and hand off to the shared `finalizeExecutionResult` helper so the
 *      work-product / COMPLETED / DONE transitions stay in exactly one place.
 *
 * Explicitly out of scope for Phase 2:
 *   - `marymary.submit_plan` custom tool (Phase 3).
 *   - `marymary.submit_work_product` custom tool (Phase 4).
 *   - Authenticated MCP tool wiring (Phase 5).
 *   - Pausing on `requires_action` for multi-turn tool loops beyond stubs
 *     (Phase 3 adds the background poller).
 */

import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Prisma, StepType, StepStatus } from "@prisma/client";
import {
  managedAgentsApi,
  BETA_QS,
  type SessionCreateBody,
  type SessionFull,
  type SessionEvent,
  type EventsResponse,
  type SessionStatusResponse,
} from "@/agents/managed-agents/client";
import builtInRegistry from "@/agents/managed-agents/builtin-registry.json";
import { resolveAgentBySlug, resolveAgent } from "@/agents/resolve";
import { resolveGnomeBySlug } from "./gnome.service";
import {
  buildAgentContext,
  finalizeExecutionResult,
  reviewWorkProduct,
  submitWorkProduct,
} from "./agent.service";
import { getDecryptedApiKey } from "./api-key.service";
import type { AgentContext, AgentDefinition, ExecutionPlan } from "@/agents/types";
import { getWorkProductDefinition } from "@/workproducts";
import {
  SUBMIT_PLAN_TOOL_NAME,
  SUBMIT_WORK_PRODUCT_TOOL_NAME,
} from "@/agents/managed-agents/sync";
import {
  getPlatformToolByName,
} from "@/agents/managed-agents/platform-tools";
import type { PlatformToolContext } from "@/agents/managed-agents/platform-tools";
import { loadProjectCredentials } from "./metrics-config.service";

// ── Module-scope caches ──────────────────────────────────

/** Cached default environment id. Single row, never changes at runtime. */
let cachedDefaultEnvironmentId: string | null = null;

// ── Internal helpers ─────────────────────────────────────

type LoadedExecution = Awaited<ReturnType<typeof loadExecutionWithRelations>>;

async function loadExecutionWithRelations(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: { include: { tactic: { include: { project: true } } } },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);
  return execution;
}

async function loadDefaultEnvironmentId(): Promise<string> {
  if (cachedDefaultEnvironmentId) return cachedDefaultEnvironmentId;
  const row = await prisma.managedAgentEnvironment.findUnique({
    where: { slug: "marymary-default" },
  });
  if (!row) {
    throw new ValidationError(
      "ManagedAgentEnvironment 'marymary-default' is missing. " +
        "Run `pnpm managed-agents:seed` (Phase 1) before enabling the feature flag.",
    );
  }
  cachedDefaultEnvironmentId = row.externalEnvironmentId;
  return cachedDefaultEnvironmentId;
}

async function loadAnthropicKey(organizationId: string): Promise<string> {
  const apiKey = await getDecryptedApiKey(organizationId, "ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new ValidationError(
      "ANTHROPIC_API_KEY not configured. Add it in your organization's API Keys settings.",
    );
  }
  return apiKey;
}

/**
 * Resolve the remote Managed Agents `agent_…` id for the gnome assigned to
 * this execution. DB gnomes carry it on their row; built-ins live in
 * `builtin-registry.json` keyed by slug.
 *
 * Throws if the gnome hasn't been synced to Managed Agents yet — this is the
 * explicit seam where Phase 1 provisioning gaps surface at execution time.
 */
async function resolveExternalAgentId(
  execution: LoadedExecution,
  agentDef: AgentDefinition,
): Promise<string> {
  const projectId = execution.task.tactic.project.id;

  // DB gnome first: resolveGnomeBySlug returns the full EffectiveGnome with
  // `isVirtual`. If it's a real DB row, fetch the `externalAgentId` column
  // directly (not exposed on EffectiveGnome).
  const effective = await resolveGnomeBySlug(projectId, agentDef.id);
  if (effective && !effective.isVirtual) {
    const dbGnome = await prisma.gnome.findUnique({
      where: { id: effective.id },
      select: { externalAgentId: true, externalAgentError: true, slug: true },
    });
    if (dbGnome?.externalAgentId) return dbGnome.externalAgentId;
    const reason = dbGnome?.externalAgentError
      ? ` Last sync error: ${dbGnome.externalAgentError}`
      : "";
    throw new ValidationError(
      `Gnome "${agentDef.id}" has no externalAgentId — it has not been synced to ` +
        `Managed Agents yet.${reason}`,
    );
  }

  // Built-in fallback: look up in the registry shipped by the seed script.
  const registry = builtInRegistry as Record<string, string>;
  const externalAgentId = registry[agentDef.id];
  if (!externalAgentId) {
    throw new ValidationError(
      `Built-in gnome "${agentDef.id}" is missing from builtin-registry.json. ` +
        "Run `pnpm managed-agents:seed` to provision it before enabling the feature flag.",
    );
  }
  return externalAgentId;
}

/**
 * Re-resolve the agent definition for an execution, matching the order used
 * by the legacy `executePlan` (slug-first, then category fallback).
 */
async function resolveAgentForExecution(execution: LoadedExecution): Promise<AgentDefinition> {
  const projectId = execution.task.tactic.project.id;
  let agentDef = execution.task.assigneeId
    ? await resolveAgentBySlug(projectId, execution.task.assigneeId, execution.task.tactic.category)
    : undefined;
  if (!agentDef) {
    agentDef = await resolveAgent(projectId, execution.task.tactic.category);
  }
  if (!agentDef) {
    throw new ValidationError(
      `No gnome found for task ${execution.task.id} (category: ${execution.task.tactic.category})`,
    );
  }
  return agentDef;
}

/**
 * Build the text of the initial `user.message` event sent to a fresh session.
 *
 * Phase 3: the session opens BEFORE plan approval. The agent's first turn is
 * expected to call the `marymary_submit_plan` custom tool (unless the gnome
 * is auto-execute, in which case the tool isn't even on the Agent and the
 * agent runs the task directly). We give the agent task context and the
 * gating instructions; the plan and the work product schema flow through the
 * custom tool's input/output, not through this initial message.
 *
 * The remote Agent's `system` field currently holds the raw Handlebars
 * template (Phase 1 did not render it), so we include the rendered system
 * prompt here too — that's the cheapest way to get per-task context in
 * without touching sync.ts. Phase 6 may move the render into sync.
 */
function buildInitialUserMessage(
  context: AgentContext,
  agentDef: AgentDefinition,
  workProductType: string | null,
): string {
  const parts: string[] = [];

  // 1. Rendered system prompt — task/project/tactic context that Phase 1
  //    deliberately left out of the remote Agent.
  try {
    parts.push(agentDef.buildSystemPrompt(context));
  } catch (err) {
    // Non-fatal: a broken template on a rarely-used gnome shouldn't sink the
    // whole execution. The remote Agent still has its raw template as `system`.
    console.warn(
      `[agent.session.service] buildSystemPrompt threw for ${agentDef.id}:`,
      err,
    );
  }

  // 2. Knowledge block (brand voice, product docs, etc).
  if (context.knowledgeBlock?.trim()) {
    parts.push("── Project knowledge ──");
    parts.push(context.knowledgeBlock.trim());
  }

  // 3. Recent metrics summary — compact, not the raw rows.
  if (context.recentMetrics.length > 0) {
    parts.push("── Recent metrics (most recent first) ──");
    parts.push(
      context.recentMetrics
        .slice(0, 10)
        .map(
          (m) =>
            `- ${m.source} · ${m.metric}: ${m.value}${m.unit ? ` ${m.unit}` : ""} (${m.recordedAt.toISOString()})`,
        )
        .join("\n"),
    );
  }

  // 4. Source work product context (task bump)
  if (context.sourceWorkProduct) {
    parts.push("── Source work product ──");
    parts.push(
      `From task "${context.sourceWorkProduct.sourceTaskTitle}" · ${context.sourceWorkProduct.definitionSlug} v${context.sourceWorkProduct.version}`,
    );
    parts.push(JSON.stringify(context.sourceWorkProduct.data, null, 2));
  }

  // 5. Previous work product (revision loop)
  if (context.previousWorkProduct) {
    parts.push("── Previous version + reviewer feedback ──");
    parts.push(`v${context.previousWorkProduct.version}`);
    parts.push(JSON.stringify(context.previousWorkProduct.data, null, 2));
    if (context.previousWorkProduct.reviewerNotes) {
      parts.push(`Reviewer notes: ${context.previousWorkProduct.reviewerNotes}`);
    }
  }

  // 6. Work product spec — Phase 4 wires this through the
  //    `marymary_submit_work_product` custom tool. The agent calls the tool
  //    with `data` matching the schema below; the session pauses for review;
  //    on revision, the same session keeps running and the agent calls the
  //    tool again with a corrected payload.
  if (workProductType) {
    const wpDef = getWorkProductDefinition(workProductType);
    if (wpDef) {
      parts.push("── Work product specification ──");
      parts.push(`Type: ${workProductType}`);
      parts.push("JSON Schema for the `data` payload:");
      parts.push(JSON.stringify(wpDef.dataSchema, null, 2));
      parts.push(
        "When you have finished producing the work product, call the " +
          "`marymary_submit_work_product` custom tool. The `data` argument " +
          "MUST conform to the schema above. Do not embed the work product " +
          "in your reply text — submit it via the tool. The session will " +
          "pause until the reviewer responds. If the result is " +
          "`{accepted: true}`, return a brief confirmation and stop. If the " +
          "result is `{accepted: false}`, the response will include " +
          "`feedback` — incorporate it and call the tool again with a " +
          "revised `data` payload. Do not stop until the reviewer accepts " +
          "or you have exhausted reasonable revision attempts.",
      );
    }
  }

  // 7. Plan-review gating instructions. Auto-execute gnomes don't have the
  //    submit_plan tool on their Agent, so we tell them to run directly.
  //    Non-auto-execute gnomes get the tool and the instruction to call it.
  parts.push("── Instructions ──");
  if (agentDef.canAutoExecute) {
    parts.push(
      "This task is configured for auto-execution. Plan internally, then " +
        "execute the plan immediately. Do not ask for confirmation.",
    );
  } else {
    parts.push(
      "Before taking any side-effectful action, call the " +
        "`marymary_submit_plan` custom tool with your proposed plan and wait " +
        "for the result. Do not start executing until you receive the " +
        "`custom_tool_result`. The result will be a JSON object: if " +
        "`approved` is true, proceed with the plan; if `approved` is false, " +
        "stop and explain that the plan was rejected (the result may include " +
        "a `reason`). Call the tool exactly once per session.",
    );
  }

  return parts.join("\n\n");
}

// ── Event → ExecutionStep projection ──────────────────────

interface StepInsert {
  kind: "insert";
  stepIndex: number;
  type: StepType;
  action: string;
  description?: string;
  tool?: string;
  toolInput?: Prisma.InputJsonValue;
  toolOutput?: Prisma.InputJsonValue;
  llmResponse?: string;
  status: StepStatus;
  error?: string;
}

interface ToolResultAttach {
  kind: "attach";
  /** id of the agent.tool_use / agent.mcp_tool_use event this result answers */
  parentToolUseEventId: string;
  toolOutput: Prisma.InputJsonValue;
  status: StepStatus;
  error?: string;
}

interface FinalTextCapture {
  /** The latest agent.message's concatenated text — finalizer reads this off. */
  lastAgentMessage?: string;
  /** Any session.error.message seen — used as error fallback. */
  lastErrorMessage?: string;
  /**
   * Latest `stop_reason.type` observed on a `session.status_idle` event.
   * The bare `GET /v1/sessions/{id}` response does NOT echo `stop_reason` —
   * it only lives on the status_idle event in the events stream — so the
   * poller has to harvest it here during hydration.
   */
  latestIdleStopReason?: string;
  /**
   * Phase 3: populated when the agent calls `marymary_submit_plan`. The
   * `customToolUseId` is the event id of the `agent.custom_tool_use` event,
   * which is also what the beta expects as `custom_tool_use_id` in the
   * `user.custom_tool_result` reply. The `input` IS the `ExecutionPlan` payload.
   */
  pendingSubmitPlan?: { customToolUseId: string; input: Record<string, unknown> };
  /**
   * Phase 4: populated when the agent calls `marymary_submit_work_product`.
   * Same shape as `pendingSubmitPlan` but the `input` is the work-product
   * submission payload `{data, notes?}` per WORK_PRODUCT_SUBMISSION_JSON_SCHEMA.
   * Across a multi-turn revision loop the agent may emit several of these;
   * we always overwrite with the latest so the resume path resolves the
   * one currently waiting.
   */
  pendingSubmitWorkProduct?: { customToolUseId: string; input: Record<string, unknown> };
  /**
   * Phase 5: populated when the agent calls a platform tool registered in
   * the `platform-tools` registry (anything other than the two reserved
   * Phase 3/4 names). Unlike `pendingSubmitPlan` and
   * `pendingSubmitWorkProduct`, these calls are *transient* — the dispatcher
   * runs the tool and resolves the call inline in the same poll tick, then
   * `continue`s to wait for the session to return to running. They are NOT
   * persisted to the `pendingCustomTool*` columns on `TaskExecution` (those
   * stay reserved for human-gated pauses).
   */
  pendingPlatformToolCall?: {
    customToolUseId: string;
    name: string;
    input: Record<string, unknown>;
  };
}

/**
 * Pure mapper from one Managed Agents SDK event to either a step insert, a
 * tool-result attach (update prior step), or null (ignore).
 *
 * `stepIndexCursor` is the next unused stepIndex. The caller increments it
 * after a successful insert.
 */
function mapEventToStep(
  event: SessionEvent,
  stepIndexCursor: number,
): StepInsert | ToolResultAttach | null {
  const type = event.type;

  // Agent text reply.
  if (type === "agent.message") {
    const content = (event as unknown as { content?: Array<{ type: string; text?: string }> })
      .content;
    const text = (content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n");
    return {
      kind: "insert",
      stepIndex: stepIndexCursor,
      type: "LLM_REASONING",
      action: "agent_message",
      llmResponse: text,
      status: "COMPLETED",
    };
  }

  // Built-in tool call.
  if (type === "agent.tool_use") {
    const e = event as unknown as { name: string; input: Record<string, unknown> };
    return {
      kind: "insert",
      stepIndex: stepIndexCursor,
      type: "TOOL_CALL",
      action: e.name,
      tool: e.name,
      toolInput: (e.input ?? {}) as Prisma.InputJsonValue,
      status: "COMPLETED",
    };
  }

  // Built-in tool result — attach to prior step.
  if (type === "agent.tool_result") {
    const e = event as unknown as {
      tool_use_id: string;
      content?: Array<{ text?: string }>;
      is_error?: boolean | null;
    };
    return {
      kind: "attach",
      parentToolUseEventId: e.tool_use_id,
      toolOutput: (e.content ?? []) as unknown as Prisma.InputJsonValue,
      status: e.is_error ? "FAILED" : "COMPLETED",
      error: e.is_error
        ? (e.content ?? []).map((c) => c.text ?? "").join("\n") || "tool reported error"
        : undefined,
    };
  }

  // MCP tool call — same shape as agent.tool_use but namespaced.
  if (type === "agent.mcp_tool_use") {
    const e = event as unknown as {
      name: string;
      mcp_server_name: string;
      input: Record<string, unknown>;
    };
    const qualified = `${e.mcp_server_name}.${e.name}`;
    return {
      kind: "insert",
      stepIndex: stepIndexCursor,
      type: "TOOL_CALL",
      action: qualified,
      tool: qualified,
      toolInput: (e.input ?? {}) as Prisma.InputJsonValue,
      status: "COMPLETED",
    };
  }

  if (type === "agent.mcp_tool_result") {
    const e = event as unknown as {
      mcp_tool_use_id: string;
      content?: Array<{ text?: string }>;
      is_error?: boolean | null;
    };
    return {
      kind: "attach",
      parentToolUseEventId: e.mcp_tool_use_id,
      toolOutput: (e.content ?? []) as unknown as Prisma.InputJsonValue,
      status: e.is_error ? "FAILED" : "COMPLETED",
      error: e.is_error
        ? (e.content ?? []).map((c) => c.text ?? "").join("\n") || "tool reported error"
        : undefined,
    };
  }

  // Custom tool — Phase 3 emits `marymary_submit_plan`; Phase 4 will add
  // `marymary_submit_work_product`. Underscores, not dots — the beta name
  // regex rejects dots.
  if (type === "agent.custom_tool_use") {
    const e = event as unknown as { name: string; input: Record<string, unknown> };
    const isWorkProduct = e.name === "marymary_submit_work_product";
    return {
      kind: "insert",
      stepIndex: stepIndexCursor,
      type: isWorkProduct ? "WORK_PRODUCT_CREATED" : "DECISION",
      action: e.name,
      tool: e.name,
      toolInput: (e.input ?? {}) as Prisma.InputJsonValue,
      status: "COMPLETED",
    };
  }

  if (type === "session.error") {
    const e = event as unknown as { error?: { message?: string } };
    return {
      kind: "insert",
      stepIndex: stepIndexCursor,
      type: "LLM_REASONING",
      action: "session_error",
      error: e.error?.message ?? "session error",
      status: "FAILED",
    };
  }

  // Everything else (session.status_*, span.model_request_*, agent.thinking,
  // agent.thread_context_compacted, user.*): not projected.
  return null;
}

// ── Public API ───────────────────────────────────────────

/**
 * Create a Managed Agents Session for an execution and send the initial
 * `user.message` with task context + gating instructions.
 *
 * Phase 3: the session opens BEFORE plan approval. Allowed entry statuses are
 * `QUEUED`, `PLANNING`, and `APPROVED` — `APPROVED` covers the auto-execute
 * gnomes that skip the plan-review pause entirely (and any manual re-runs of
 * an already-approved row). The non-auto-execute path is expected to land in
 * `requires_action` after the agent calls `marymary_submit_plan`.
 *
 * State transition: → PRODUCING. The poller flips back to AWAITING_APPROVAL
 * (via `persistPendingPlan`) when it detects the submit_plan custom tool call.
 */
export async function startSessionForTask(executionId: string): Promise<{
  execution: Awaited<ReturnType<typeof prisma.taskExecution.update>>;
  sessionId: string;
}> {
  const execution = await loadExecutionWithRelations(executionId);

  // Idempotency guard: if a session is already in flight for this row (either
  // mid-execution or pending plan review), do not double-create. This
  // protects against double-clicks on approve and overlapping route + MCP
  // approve calls.
  if (
    execution.externalSessionId &&
    (execution.status === "PRODUCING" || execution.status === "AWAITING_APPROVAL")
  ) {
    return { execution, sessionId: execution.externalSessionId };
  }

  if (
    execution.status !== "QUEUED" &&
    execution.status !== "PLANNING" &&
    execution.status !== "APPROVED"
  ) {
    throw new ValidationError(
      `Cannot start Managed Agents session for execution in status: ${execution.status}`,
    );
  }

  const orgId = execution.task.tactic.project.organizationId;
  if (!orgId) {
    throw new ValidationError("Project must belong to an organization to execute tasks.");
  }
  const apiKey = await loadAnthropicKey(orgId);

  const agentDef = await resolveAgentForExecution(execution);
  const externalAgentId = await resolveExternalAgentId(execution, agentDef);
  const environmentId = await loadDefaultEnvironmentId();

  const context = await buildAgentContext(execution.task, execution, agentDef);
  const initialText = buildInitialUserMessage(context, agentDef, execution.workProductType);

  // Metadata values MUST be strings — SDK enforces Record<string, string>.
  const metadata: Record<string, string> = {
    source: "marymary",
    executionId: execution.id,
    taskId: execution.task.id,
    tacticId: execution.task.tacticId,
    projectId: execution.task.tactic.project.id,
    organizationId: orgId,
    gnomeSlug: agentDef.id,
  };

  // 1. Transition the row to PRODUCING + flip in-flight external* columns
  //    BEFORE creating the remote session, so that if the beta request fails
  //    we still land in the catch block below with the right row state.
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "PRODUCING",
      externalStatus: "running",
      externalEnvironmentId: environmentId,
      sessionMetadata: metadata as unknown as Prisma.InputJsonValue,
      startedAt: execution.startedAt ?? new Date(),
    },
  });

  try {
    // 2. Create the empty session.
    const createBody: SessionCreateBody = {
      agent: externalAgentId,
      environment_id: environmentId,
      metadata,
      title: `${execution.task.title} — exec ${execution.id.slice(0, 8)}`,
    };
    const session = await managedAgentsApi<SessionFull>(
      "POST",
      `/v1/sessions${BETA_QS}`,
      createBody,
      apiKey,
    );

    // 3. Persist the session id immediately so a crash between this and the
    //    first `user.message` POST still leaves us a recoverable pointer.
    const updated = await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        externalSessionId: session.id,
      },
    });

    // 4. Send the initial user.message event.
    await managedAgentsApi(
      "POST",
      `/v1/sessions/${session.id}/events${BETA_QS}`,
      {
        events: [
          {
            type: "user.message",
            content: [{ type: "text", text: initialText }],
          },
        ],
      },
      apiKey,
    );

    console.log(
      `[managed-agents] session created ${session.id} for execution ${executionId} (gnome: ${agentDef.id})`,
    );

    return { execution: updated, sessionId: session.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Managed Agents session start failed";
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        error: message,
        completedAt: new Date(),
        externalStatus: "terminated",
      },
    });
    throw error;
  }
}

/**
 * Append a `user.message` event to an existing session. Unused in Phase 2's
 * main execute path (the initial message is sent inside `startSessionForTask`)
 * but exposed for follow-up interactive prompts and for the compare script.
 */
export async function sendUserMessage(executionId: string, text: string): Promise<void> {
  const { sessionId, apiKey } = await requireOpenSession(executionId);
  await managedAgentsApi(
    "POST",
    `/v1/sessions/${sessionId}/events${BETA_QS}`,
    {
      events: [{ type: "user.message", content: [{ type: "text", text }] }],
    },
    apiKey,
  );
}

/**
 * Resolve a pending custom tool call by appending a `user.custom_tool_result`
 * event. Used by Phase 3's `resumeSessionAfterApproval` /
 * `cancelSessionWithRejection` for `marymary_submit_plan`, and reserved for
 * Phase 4's `marymary_submit_work_product`.
 *
 * The beta requires `content` to be a content-block array, NOT a raw object —
 * JSON payloads must be stringified inside a `{type:"text", text}` block.
 */
export async function resolveCustomToolCall(
  executionId: string,
  customToolUseId: string,
  result: { content: unknown; isError?: boolean },
): Promise<void> {
  const { sessionId, apiKey } = await requireOpenSession(executionId);
  const contentBlocks =
    typeof result.content === "string"
      ? [{ type: "text", text: result.content }]
      : [{ type: "text", text: JSON.stringify(result.content) }];
  await managedAgentsApi(
    "POST",
    `/v1/sessions/${sessionId}/events${BETA_QS}`,
    {
      events: [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: customToolUseId,
          content: contentBlocks,
          is_error: Boolean(result.isError),
        },
      ],
    },
    apiKey,
  );
}

/** Phase 2 stub — counterpart for built-in / MCP tool confirmations. */
export async function confirmToolUse(
  executionId: string,
  toolUseId: string,
  decision: "allow" | "deny",
  denyMessage?: string,
): Promise<void> {
  const { sessionId, apiKey } = await requireOpenSession(executionId);
  await managedAgentsApi(
    "POST",
    `/v1/sessions/${sessionId}/events${BETA_QS}`,
    {
      events: [
        {
          type: "user.tool_confirmation",
          tool_use_id: toolUseId,
          result: decision,
          ...(decision === "deny" && denyMessage ? { deny_message: denyMessage } : {}),
        },
      ],
    },
    apiKey,
  );
}

/** Best-effort interrupt — for cancel buttons and poller timeouts. */
export async function interruptSession(executionId: string): Promise<void> {
  const execution = await loadExecutionWithRelations(executionId);
  if (!execution.externalSessionId) return;
  const orgId = execution.task.tactic.project.organizationId;
  if (!orgId) return;
  const apiKey = await loadAnthropicKey(orgId).catch(() => null);
  if (!apiKey) return;

  try {
    await managedAgentsApi(
      "POST",
      `/v1/sessions/${execution.externalSessionId}/events${BETA_QS}`,
      { events: [{ type: "user.interrupt" }] },
      apiKey,
    );
  } catch (err) {
    console.warn(`[managed-agents] interrupt failed for ${executionId}:`, err);
  }
}

/**
 * Pull any new events from `/v1/sessions/{id}/events` since the last cursor,
 * project them into `ExecutionStep` rows, update the cursor, and return
 * { newSteps, finalText, errorMessage } so the poller can make its next
 * decision.
 *
 * Pagination: Phase 2 uses the same "fetch all in order, dedupe in memory"
 * strategy as the smoke script. Phase 3 upgrades to `?after=` once we need
 * to survive multi-minute sessions.
 */
export async function hydrateEvents(executionId: string): Promise<{
  newSteps: number;
  finalText: FinalTextCapture;
}> {
  const execution = await loadExecutionWithRelations(executionId);
  if (!execution.externalSessionId) {
    throw new ValidationError(`Execution ${executionId} has no externalSessionId`);
  }
  const orgId = execution.task.tactic.project.organizationId;
  if (!orgId) throw new ValidationError("Missing organization for execution");
  const apiKey = await loadAnthropicKey(orgId);

  const events = await managedAgentsApi<EventsResponse>(
    "GET",
    `/v1/sessions/${execution.externalSessionId}/events${BETA_QS}&order=asc`,
    undefined,
    apiKey,
  );

  // Already-processed event ids. Cheapest way to dedup across polls: fetch
  // the set of tool-use event ids we've already mapped via ExecutionStep.
  // But ExecutionSteps don't have a natural event-id column — we rely on the
  // `externalLastEventId` cursor for streaming forward progress. Build a
  // Set from the already-emitted events up to and including the cursor.
  const ordered = events.data as SessionEvent[];
  const lastSeen = execution.externalLastEventId;
  let passedCursor = !lastSeen;
  const freshEvents: SessionEvent[] = [];
  for (const evt of ordered) {
    if (!passedCursor) {
      if (evt.id === lastSeen) {
        passedCursor = true;
      }
      continue;
    }
    freshEvents.push(evt);
  }

  if (freshEvents.length === 0) {
    return { newSteps: 0, finalText: {} };
  }

  // We also need to map `tool_use_id` → ExecutionStep.id so `agent.tool_result`
  // can update the prior row. Build that map from the in-memory event list —
  // we walk all events (not just fresh) because the fresh batch might only
  // contain the result, with its tool_use having been processed in a prior poll.
  // For in-flight lookups we query ExecutionStep on the fly by event-id-as-toolInput.
  // Simpler approach: keep an in-memory map { eventId → sessionEventId } and
  // look up the step by toolInput->>"_evtId". We record `_evtId` in toolInput
  // on insert so the attach phase can find its parent later.

  // Step index cursor — ExecutionStep rows are currently the single source of
  // truth for "what's the next index?".
  const currentMax = await prisma.executionStep.findFirst({
    where: { executionId },
    orderBy: { stepIndex: "desc" },
    select: { stepIndex: true },
  });
  let nextIndex = currentMax ? currentMax.stepIndex + 1 : 0;

  const finalText: FinalTextCapture = {};
  let newSteps = 0;
  let latestEventId = lastSeen ?? undefined;
  let externalStatusUpdate: string | undefined;

  for (const evt of freshEvents) {
    latestEventId = evt.id;

    // Track status transitions from session.status_* events so we can persist
    // the latest mirror of session.status without an extra GET.
    if (evt.type === "session.status_running") externalStatusUpdate = "running";
    if (evt.type === "session.status_idle") {
      externalStatusUpdate = "idle";
      // The session GET endpoint does NOT return `stop_reason`; it only lives
      // on this event. Capture it so pollUntilIdle can route to the right
      // success/failure branch instead of bailing on "unknown stop_reason".
      const idleEvt = evt as unknown as { stop_reason?: { type?: string } };
      if (idleEvt.stop_reason?.type) {
        finalText.latestIdleStopReason = idleEvt.stop_reason.type;
      }
    }
    if (evt.type === "session.status_terminated") externalStatusUpdate = "terminated";
    if (evt.type === "session.status_rescheduled") externalStatusUpdate = "rescheduling";

    // Capture the agent's latest full-text message — used as outputText at finalize.
    if (evt.type === "agent.message") {
      const content = (evt as unknown as { content?: Array<{ type: string; text?: string }> })
        .content;
      finalText.lastAgentMessage = (content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n");
    }
    if (evt.type === "session.error") {
      const e = evt as unknown as { error?: { message?: string } };
      finalText.lastErrorMessage = e.error?.message;
    }

    // Phase 3/4: capture marymary_submit_plan / marymary_submit_work_product
    // custom tool calls so the poller can transition to AWAITING_APPROVAL or
    // WORK_REVIEW on requires_action. The custom_tool_use_id we'll send back
    // IS this event's id.
    if (evt.type === "agent.custom_tool_use") {
      const e = evt as unknown as { name: string; input: Record<string, unknown> };
      if (e.name === SUBMIT_PLAN_TOOL_NAME) {
        finalText.pendingSubmitPlan = {
          customToolUseId: evt.id,
          input: e.input ?? {},
        };
      } else if (e.name === SUBMIT_WORK_PRODUCT_TOOL_NAME) {
        finalText.pendingSubmitWorkProduct = {
          customToolUseId: evt.id,
          input: e.input ?? {},
        };
      } else {
        // Phase 5: anything else is a platform tool call. The dispatcher in
        // pollUntilIdle will look it up by name in the platform-tools registry
        // and either run it inline or resolve `unknown_tool` if it isn't
        // registered. Always overwrite — only the most recent platform call
        // matters per poll tick.
        finalText.pendingPlatformToolCall = {
          customToolUseId: evt.id,
          name: e.name,
          input: e.input ?? {},
        };
      }
    }

    const mapped = mapEventToStep(evt, nextIndex);
    if (!mapped) continue;

    if (mapped.kind === "attach") {
      // Find the prior step by its stored `_evtId` in toolInput.
      // Prisma doesn't type Json path filters well; do a small in-process scan.
      const priorSteps = await prisma.executionStep.findMany({
        where: { executionId, type: "TOOL_CALL" },
        select: { id: true, toolInput: true },
        orderBy: { stepIndex: "desc" },
        take: 50,
      });
      const parent = priorSteps.find((s) => {
        const ti = s.toolInput as unknown as { _evtId?: string } | null;
        return ti?._evtId === mapped.parentToolUseEventId;
      });
      if (parent) {
        await prisma.executionStep.update({
          where: { id: parent.id },
          data: {
            toolOutput: mapped.toolOutput,
            status: mapped.status,
            error: mapped.error,
            completedAt: new Date(),
          },
        });
      }
      continue;
    }

    // New step insert. Embed `_evtId` inside toolInput so a later
    // agent.tool_result can find this row by its originating event id.
    const toolInputWithEvt =
      mapped.type === "TOOL_CALL" || mapped.type === "WORK_PRODUCT_CREATED" || mapped.type === "DECISION"
        ? ({
            ...(typeof mapped.toolInput === "object" && mapped.toolInput !== null
              ? (mapped.toolInput as Record<string, unknown>)
              : {}),
            _evtId: evt.id,
          } as Prisma.InputJsonValue)
        : mapped.toolInput;

    await prisma.executionStep.create({
      data: {
        executionId,
        stepIndex: mapped.stepIndex,
        type: mapped.type,
        action: mapped.action,
        description: mapped.description,
        tool: mapped.tool,
        toolInput: toolInputWithEvt,
        toolOutput: mapped.toolOutput,
        llmResponse: mapped.llmResponse,
        status: mapped.status,
        error: mapped.error,
        completedAt: new Date(),
      },
    });
    nextIndex += 1;
    newSteps += 1;
  }

  // Advance the cursor + mirror the latest session status.
  if (latestEventId || externalStatusUpdate) {
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        ...(latestEventId ? { externalLastEventId: latestEventId } : {}),
        ...(externalStatusUpdate ? { externalStatus: externalStatusUpdate } : {}),
      },
    });
  }

  return { newSteps, finalText };
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
// Phase 5 bump: a task that calls 5–10 platform tools is now realistic and
// each call adds ~5–10s of round-trip latency for hydration + dispatch +
// resolveCustomToolCall. 300s gives us comfortable headroom for the
// social-media gnome's "fetch GA → browse media library → request design"
// chain that drove the §8g pilot stall.
const DEFAULT_POLL_TIMEOUT_MS = 300_000;

/**
 * Poll the session until it reaches an idle+end_turn stop, a terminal error,
 * or the timeout. Mirrors the smoke-script loop, but persists steps and
 * finalizes the TaskExecution row on exit.
 *
 * Called from the execute route's `after()` callback after `startSessionForTask`.
 */
export async function pollUntilIdle(
  executionId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<{ status: string; stopReason?: string }> {
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const startedAt = Date.now();

  const loaded = await loadExecutionWithRelations(executionId);
  const orgId = loaded.task.tactic.project.organizationId;
  if (!orgId) throw new ValidationError("Missing organization for execution");
  const apiKey = await loadAnthropicKey(orgId);
  if (!loaded.externalSessionId) {
    throw new ValidationError(`Execution ${executionId} has no externalSessionId`);
  }
  const sessionId = loaded.externalSessionId;

  let lastFinalText: FinalTextCapture = {};
  let lastStatus: SessionStatusResponse | null = null;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const hydrated = await hydrateEvents(executionId);
      if (hydrated.finalText.lastAgentMessage) {
        lastFinalText.lastAgentMessage = hydrated.finalText.lastAgentMessage;
      }
      if (hydrated.finalText.lastErrorMessage) {
        lastFinalText.lastErrorMessage = hydrated.finalText.lastErrorMessage;
      }
      if (hydrated.finalText.latestIdleStopReason) {
        lastFinalText.latestIdleStopReason = hydrated.finalText.latestIdleStopReason;
      }
      if (hydrated.finalText.pendingSubmitPlan) {
        lastFinalText.pendingSubmitPlan = hydrated.finalText.pendingSubmitPlan;
      }
      if (hydrated.finalText.pendingSubmitWorkProduct) {
        lastFinalText.pendingSubmitWorkProduct = hydrated.finalText.pendingSubmitWorkProduct;
      }
      if (hydrated.finalText.pendingPlatformToolCall) {
        lastFinalText.pendingPlatformToolCall = hydrated.finalText.pendingPlatformToolCall;
      }

      lastStatus = await managedAgentsApi<SessionStatusResponse>(
        "GET",
        `/v1/sessions/${sessionId}${BETA_QS}`,
        undefined,
        apiKey,
      );

      if (lastStatus.status === "idle") {
        // The session GET response does not echo `stop_reason` — only the
        // `session.status_idle` event does. Prefer the value harvested by
        // hydrateEvents, fall back to the GET response just in case the
        // beta starts populating it later.
        const stopType =
          lastFinalText.latestIdleStopReason ?? lastStatus.stop_reason?.type;
        if (stopType === "end_turn") {
          // Success — flush telemetry + work-product branch.
          await finalizeFromSession(executionId, sessionId, apiKey, lastFinalText, true);
          return { status: "idle", stopReason: stopType };
        }
        if (stopType === "requires_action") {
          // Phase 3: pause for plan review. Persist the pending submit_plan
          // call so approve/reject can resolve it later.
          if (lastFinalText.pendingSubmitPlan) {
            await persistPendingPlan(executionId, lastFinalText.pendingSubmitPlan);
            return { status: "idle", stopReason: stopType };
          }
          // Phase 4: pause for work-product review. The submit_work_product
          // call lands the row in WORK_REVIEW + creates a WorkProduct row.
          // For work products with `requiresReview: false`, persistPending…
          // auto-resolves the tool call and returns "auto-approved" so we
          // continue polling instead of returning early.
          if (lastFinalText.pendingSubmitWorkProduct) {
            const handled = await persistPendingWorkProduct(
              executionId,
              lastFinalText.pendingSubmitWorkProduct,
            );
            // Once the auto-approve resolution kicks the session, the next
            // hydration cycle will re-emit the same `pendingSubmitWorkProduct`
            // capture from the still-present event in `events.data`. Clear
            // it locally so we don't double-handle.
            lastFinalText.pendingSubmitWorkProduct = undefined;
            if (handled === "auto-approved") {
              continue;
            }
            return { status: "idle", stopReason: stopType };
          }
          // Phase 5: a platform tool call (anything other than the two
          // reserved Phase 3/4 names). The dispatcher runs the tool inline
          // and resolves the custom_tool_use, after which the session goes
          // back to running. We `continue` rather than `return` so the same
          // poll loop drains the next state — the existing timeout window
          // (DEFAULT_POLL_TIMEOUT_MS) covers a multi-tool chain.
          if (lastFinalText.pendingPlatformToolCall) {
            await dispatchPlatformToolCall(
              executionId,
              sessionId,
              lastFinalText.pendingPlatformToolCall,
            );
            // Clear locally so the next hydration cycle (which still sees the
            // same `agent.custom_tool_use` event in the events feed) doesn't
            // re-dispatch. Same defensive pattern as pendingSubmitWorkProduct.
            lastFinalText.pendingPlatformToolCall = undefined;
            continue;
          }
          // Safety net: requires_action arrived without any matching pending
          // capture. Should never fire — would indicate a hydrate bug.
          console.warn(
            `[managed-agents] session ${sessionId} idle on requires_action with no known pending custom tool; leaving stuck for diagnosis.`,
          );
          return { status: "idle", stopReason: stopType };
        }
        if (stopType === "retries_exhausted") {
          await failExecution(
            executionId,
            lastFinalText.lastErrorMessage ?? "Managed Agents retries exhausted",
          );
          await archiveSession(sessionId, apiKey);
          return { status: "idle", stopReason: stopType };
        }
        // Unknown stop reason — drain once more then bail.
        console.warn(
          `[managed-agents] session ${sessionId} idle with unknown stop_reason:`,
          lastStatus.stop_reason,
        );
        return { status: "idle", stopReason: stopType };
      }

      if (lastStatus.status === "terminated") {
        await failExecution(
          executionId,
          lastFinalText.lastErrorMessage ?? "Managed Agents session terminated",
        );
        await archiveSession(sessionId, apiKey);
        return { status: "terminated" };
      }

      await sleep(intervalMs);
    }

    // Timeout — drain whatever is left and fail the execution.
    await hydrateEvents(executionId).catch(() => undefined);
    await failExecution(
      executionId,
      `Managed Agents session timed out after ${timeoutMs}ms (status: ${lastStatus?.status ?? "unknown"})`,
    );
    await archiveSession(sessionId, apiKey);
    return { status: "timeout" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "pollUntilIdle failed";
    await failExecution(executionId, message);
    await archiveSession(sessionId, apiKey).catch(() => undefined);
    throw error;
  }
}

/**
 * Phase 5 — server-side dispatcher for platform tool calls.
 *
 * Called from `pollUntilIdle` when the session idles on `requires_action` and
 * the pending custom tool is anything other than the two reserved Phase 3/4
 * names. Looks the tool up in the platform-tools registry, loads any
 * required credentials from MetricsConfig (via the shared
 * `loadProjectCredentials` helper that the legacy path also uses), executes
 * the tool, resolves the call back to the beta, and writes a single
 * ExecutionStep row so the UI's step list stays accurate.
 *
 * Failure modes (all resolve the call with `isError: true` so the agent can
 * adapt in its next turn rather than wedging the session):
 *   - `unknown_tool`        — name not in the registry
 *   - `credential_missing`  — tool needs creds but none matched its requiredSources
 *   - `execute_threw`       — the tool's execute() function raised
 *
 * Does NOT touch `pendingCustomToolUseId` / `pendingCustomToolName` on the
 * TaskExecution row — those stay reserved for human-gated pauses (plan +
 * work-product). Platform tool dispatch is fire-and-forget per poll tick.
 */
async function dispatchPlatformToolCall(
  executionId: string,
  sessionId: string,
  pending: { customToolUseId: string; name: string; input: Record<string, unknown> },
): Promise<void> {
  console.log(
    `[managed-agents] dispatching platform tool ${pending.name} for execution ${executionId}`,
  );

  // Look up the tool first so a typo / removed-but-still-registered-on-beta
  // tool fails fast without loading credentials.
  const tool = getPlatformToolByName(pending.name);

  // Common bookkeeping: figure out the next stepIndex so the row we write
  // doesn't collide with the existing event-projected steps.
  const lastStep = await prisma.executionStep.findFirst({
    where: { executionId },
    orderBy: { stepIndex: "desc" },
    select: { stepIndex: true },
  });
  const stepIndex = (lastStep?.stepIndex ?? -1) + 1;

  if (!tool) {
    const errorPayload = { error: "unknown_tool", name: pending.name };
    await resolveCustomToolCall(executionId, pending.customToolUseId, {
      content: errorPayload,
      isError: true,
    });
    await prisma.executionStep.create({
      data: {
        executionId,
        stepIndex,
        type: "TOOL_CALL",
        action: pending.name,
        tool: pending.name,
        toolInput: {
          ...(pending.input as Prisma.InputJsonObject),
          _evtId: pending.customToolUseId,
        },
        toolOutput: errorPayload as Prisma.InputJsonValue,
        status: "FAILED",
        error: `Unknown platform tool: ${pending.name}`,
        completedAt: new Date(),
      },
    });
    console.warn(
      `[managed-agents] session ${sessionId} called unknown platform tool "${pending.name}"`,
    );
    return;
  }

  // Build the per-call PlatformToolContext from the loaded execution row.
  const loaded = await loadExecutionWithRelations(executionId);
  const project = loaded.task.tactic.project;
  const ctx: PlatformToolContext = {
    executionId,
    taskId: loaded.taskId,
    tacticId: loaded.task.tacticId,
    projectId: project.id,
    projectSlug: project.slug,
    organizationId: project.organizationId ?? null,
    prisma,
  };

  // Load credentials if the tool declares any required sources. Reuses the
  // same helper as the legacy path — single source of truth for credential
  // loading on either side of the migration.
  if (tool.requiredSources.length > 0) {
    const credsMap = await loadProjectCredentials(
      project.id,
      project.organizationId ?? null,
    );
    let matched: { creds: Record<string, unknown>; meta?: Record<string, unknown> } | undefined;
    for (const source of tool.requiredSources) {
      const entry = credsMap.get(source);
      if (entry) {
        matched = entry;
        break;
      }
    }
    if (!matched) {
      const errorPayload = {
        error: "credential_missing",
        source: tool.requiredSources[0],
        note: `No enabled MetricsConfig found for source "${tool.requiredSources[0]}". Connect the integration in marymary's settings.`,
      };
      await resolveCustomToolCall(executionId, pending.customToolUseId, {
        content: errorPayload,
        isError: true,
      });
      await prisma.executionStep.create({
        data: {
          executionId,
          stepIndex,
          type: "TOOL_CALL",
          action: pending.name,
          tool: pending.name,
          toolInput: {
            ...(pending.input as Prisma.InputJsonObject),
            _evtId: pending.customToolUseId,
          },
          toolOutput: errorPayload as Prisma.InputJsonValue,
          status: "FAILED",
          error: `Missing credentials: ${tool.requiredSources[0]}`,
          completedAt: new Date(),
        },
      });
      return;
    }
    ctx.credentials = matched.creds;
    ctx.credentialsMeta = matched.meta;
  }

  // Execute and resolve. Catches a thrown error from the tool's execute()
  // and resolves with `execute_threw` instead of letting the exception
  // unwind to pollUntilIdle's outer try (which would fail the execution).
  try {
    const result = await tool.execute(pending.input, ctx);
    await resolveCustomToolCall(executionId, pending.customToolUseId, {
      content: result,
    });
    await prisma.executionStep.create({
      data: {
        executionId,
        stepIndex,
        type: "TOOL_CALL",
        action: pending.name,
        tool: pending.name,
        toolInput: {
          ...(pending.input as Prisma.InputJsonObject),
          _evtId: pending.customToolUseId,
        },
        toolOutput: result as Prisma.InputJsonValue,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    console.log(
      `[managed-agents] resolved platform tool ${pending.name} for execution ${executionId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorPayload = { error: "execute_threw", message };
    await resolveCustomToolCall(executionId, pending.customToolUseId, {
      content: errorPayload,
      isError: true,
    });
    await prisma.executionStep.create({
      data: {
        executionId,
        stepIndex,
        type: "TOOL_CALL",
        action: pending.name,
        tool: pending.name,
        toolInput: {
          ...(pending.input as Prisma.InputJsonObject),
          _evtId: pending.customToolUseId,
        },
        toolOutput: errorPayload as Prisma.InputJsonValue,
        status: "FAILED",
        error: message,
        completedAt: new Date(),
      },
    });
    console.warn(
      `[managed-agents] platform tool ${pending.name} threw for execution ${executionId}: ${message}`,
    );
  }
}

/**
 * Phase 3: open a session and poll until the agent calls
 * `marymary_submit_plan` (→ AWAITING_APPROVAL) or runs to end_turn (auto-
 * execute gnomes that skip the gate). Returns the persisted `ExecutionPlan`
 * for parity with the legacy `generatePlan` signature so call sites that
 * destructure `.steps` keep working.
 */
export async function generatePlanViaSession(executionId: string): Promise<ExecutionPlan> {
  const execution = await loadExecutionWithRelations(executionId);
  if (execution.status !== "QUEUED" && execution.status !== "PLANNING") {
    throw new ValidationError(
      `Cannot generate plan for execution in status: ${execution.status}`,
    );
  }

  // Move to PLANNING up front so the UI flips off QUEUED before the beta
  // call. startSessionForTask will then transition PLANNING → PRODUCING.
  if (execution.status === "QUEUED") {
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { status: "PLANNING" },
    });
  }

  await startSessionForTask(executionId);
  await pollUntilIdle(executionId);

  // Re-load to pick up the plan persisted by persistPendingPlan (or, for
  // auto-execute gnomes that skipped the gate, whatever finalize wrote).
  const after = await prisma.taskExecution.findUniqueOrThrow({
    where: { id: executionId },
    select: { plan: true, status: true },
  });
  return (after.plan as unknown as ExecutionPlan) ?? {
    summary: "",
    steps: [],
    requiresApproval: false,
  };
}

/**
 * Phase 3: resume a session that idled on `requires_action(submit_plan)` by
 * sending an approval `custom_tool_result`. Caller is responsible for wrapping
 * the follow-up `pollUntilIdle` in `after()` — this function only kicks the
 * session back into running.
 */
export async function resumeSessionAfterApproval(
  executionId: string,
  approverUserId: string,
): Promise<void> {
  const execution = await loadExecutionWithRelations(executionId);
  if (execution.status !== "APPROVED") {
    throw new ValidationError(
      `Cannot resume session for execution in status: ${execution.status}`,
    );
  }
  if (!execution.pendingCustomToolUseId) {
    throw new ValidationError(
      `Execution ${executionId} has no pendingCustomToolUseId — cannot resume.`,
    );
  }

  await resolveCustomToolCall(executionId, execution.pendingCustomToolUseId, {
    content: {
      approved: true,
      reviewer: approverUserId,
      approvedAt: new Date().toISOString(),
    },
  });

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "PRODUCING",
      externalStatus: "running",
      pendingCustomToolUseId: null,
      pendingCustomToolName: null,
    },
  });
}

/**
 * Phase 3: reject a pending submit_plan. Sends a `custom_tool_result` with
 * `approved: false`, interrupts the session, archives it, and resets the row
 * to REJECTED + the parent task back to TODO (mirrors legacy `rejectPlan`).
 */
export async function cancelSessionWithRejection(
  executionId: string,
  rejectedByUserId: string,
  reason?: string,
): Promise<void> {
  const execution = await loadExecutionWithRelations(executionId);
  if (execution.status !== "AWAITING_APPROVAL") {
    throw new ValidationError(
      `Cannot reject plan for execution in status: ${execution.status}`,
    );
  }
  if (!execution.pendingCustomToolUseId) {
    throw new ValidationError(
      `Execution ${executionId} has no pendingCustomToolUseId — cannot reject.`,
    );
  }

  const rejectionReason = reason ?? "rejected by reviewer";

  // Best-effort: send the rejection result first so the agent's transcript
  // shows the reason. Then interrupt + archive to free the session slot.
  try {
    await resolveCustomToolCall(executionId, execution.pendingCustomToolUseId, {
      content: { approved: false, reason: rejectionReason },
    });
  } catch (err) {
    console.warn(
      `[managed-agents] resolveCustomToolCall(reject) failed for ${executionId}:`,
      err,
    );
  }

  await interruptSession(executionId);

  if (execution.externalSessionId) {
    const orgId = execution.task.tactic.project.organizationId;
    if (orgId) {
      const apiKey = await loadAnthropicKey(orgId).catch(() => null);
      if (apiKey) {
        await archiveSession(execution.externalSessionId, apiKey);
      }
    }
  }

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedBy: rejectedByUserId,
      rejectionReason,
      completedAt: new Date(),
      externalStatus: "terminated",
      pendingCustomToolUseId: null,
      pendingCustomToolName: null,
    },
  });

  // Reset the parent task to TODO so it can be re-planned.
  await prisma.task.update({
    where: { id: execution.task.id },
    data: { status: "TODO" },
  });
}

// ── Private: success + failure paths ─────────────────────

/**
 * Phase 3: store the agent's proposed plan and pause the row in
 * AWAITING_APPROVAL. The `pending.input` object IS the ExecutionPlan payload —
 * the agent submits it as the custom tool's `input` per EXECUTION_PLAN_JSON_SCHEMA.
 */
async function persistPendingPlan(
  executionId: string,
  pending: { customToolUseId: string; input: Record<string, unknown> },
): Promise<void> {
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "AWAITING_APPROVAL",
      plan: pending.input as unknown as Prisma.InputJsonValue,
      pendingCustomToolUseId: pending.customToolUseId,
      pendingCustomToolName: SUBMIT_PLAN_TOOL_NAME,
      externalStatus: "idle",
    },
  });
}

/**
 * Phase 4: handle a pending `marymary_submit_work_product` custom tool call.
 *
 *   1. Persist the agent's submission as a new `WorkProduct` row (versioned)
 *      via `submitWorkProduct`, which also transitions the execution row to
 *      `WORK_REVIEW`.
 *   2. Stash the custom-tool-use id so the resume helpers can target it.
 *   3. If the work product type has `requiresReview: false`, immediately
 *      resolve the tool call with `accepted: true` and run the existing
 *      approve+deliver path. Returns `"auto-approved"` so the poller
 *      continues draining the session instead of pausing.
 *   4. Otherwise return `"paused"` — the poller stops and the human review
 *      action will resume the session via `approveWorkProductInSession` or
 *      friends.
 *
 * Returns `"failed"` if the row is missing a `workProductType` or the
 * submission can't be persisted; the poller logs and bails to the warn
 * branch in that case.
 */
async function persistPendingWorkProduct(
  executionId: string,
  pending: { customToolUseId: string; input: Record<string, unknown> },
): Promise<"auto-approved" | "paused" | "failed"> {
  const row = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    select: { workProductType: true },
  });
  if (!row?.workProductType) {
    console.warn(
      `[managed-agents] persistPendingWorkProduct: execution ${executionId} has no workProductType — ignoring submit_work_product call.`,
    );
    return "failed";
  }

  const data =
    typeof pending.input.data === "object" && pending.input.data !== null
      ? (pending.input.data as Record<string, unknown>)
      : undefined;
  if (!data) {
    console.warn(
      `[managed-agents] persistPendingWorkProduct: submit_work_product call for ${executionId} is missing the required \`data\` object — ignoring.`,
    );
    return "failed";
  }
  const notes = typeof pending.input.notes === "string" ? pending.input.notes : undefined;

  // Create the WorkProduct row + transition execution → WORK_REVIEW.
  // submitWorkProduct handles versioning (v1 / v2 / v3 …) automatically.
  try {
    await submitWorkProduct(executionId, row.workProductType, data, notes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[managed-agents] persistPendingWorkProduct: submitWorkProduct failed for ${executionId}: ${message}`,
    );
    return "failed";
  }

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      pendingCustomToolUseId: pending.customToolUseId,
      pendingCustomToolName: SUBMIT_WORK_PRODUCT_TOOL_NAME,
      externalStatus: "idle",
    },
  });

  // Auto-approve branch: if the work product definition does not require
  // human review, resolve the tool call right now and run the existing
  // approve+deliver path. We feed `"system"` as the reviewer userId.
  const wpDef = getWorkProductDefinition(row.workProductType);
  if (wpDef && wpDef.requiresReview === false) {
    try {
      await resolveCustomToolCall(executionId, pending.customToolUseId, {
        content: { accepted: true, autoApproved: true },
      });
    } catch (err) {
      console.warn(
        `[managed-agents] auto-approve resolveCustomToolCall failed for ${executionId}:`,
        err,
      );
    }
    // Clear the pending fields and let reviewWorkProduct drive the row to
    // DELIVERING/COMPLETED via the legacy approve flow.
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        pendingCustomToolUseId: null,
        pendingCustomToolName: null,
      },
    });
    try {
      await reviewWorkProduct(executionId, "system", "approve");
    } catch (err) {
      console.warn(
        `[managed-agents] auto-approve reviewWorkProduct failed for ${executionId}:`,
        err,
      );
    }
    return "auto-approved";
  }

  return "paused";
}

/**
 * Phase 4: resume a session that idled on `requires_action(submit_work_product)`
 * after a human approved the work product. The legacy `reviewWorkProduct`
 * call already drove the row to DELIVERING/COMPLETED before we get here —
 * this helper just notifies the session so it can wrap up with a final
 * acknowledgement turn and reach `end_turn`. Caller is responsible for
 * wrapping the follow-up `pollUntilIdle` in `after()` so the final telemetry
 * lands.
 */
export async function approveWorkProductInSession(
  executionId: string,
  approverUserId: string,
  edits?: Record<string, unknown>,
): Promise<void> {
  const execution = await loadExecutionWithRelations(executionId);
  if (!execution.pendingCustomToolUseId) {
    throw new ValidationError(
      `Execution ${executionId} has no pendingCustomToolUseId — cannot resume work-product session.`,
    );
  }
  if (execution.pendingCustomToolName !== SUBMIT_WORK_PRODUCT_TOOL_NAME) {
    throw new ValidationError(
      `Execution ${executionId} pendingCustomToolName is "${execution.pendingCustomToolName}", expected "${SUBMIT_WORK_PRODUCT_TOOL_NAME}".`,
    );
  }

  await resolveCustomToolCall(executionId, execution.pendingCustomToolUseId, {
    content: {
      accepted: true,
      reviewer: approverUserId,
      approvedAt: new Date().toISOString(),
      ...(edits ? { edits } : {}),
    },
  });

  // Clear the pending fields. We deliberately do NOT change `status` here —
  // reviewWorkProduct already moved the row to DELIVERING (or COMPLETED).
  // The follow-up pollUntilIdle drains the session to end_turn for telemetry.
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      pendingCustomToolUseId: null,
      pendingCustomToolName: null,
    },
  });
}

/**
 * Phase 4: send a revision request back into a session that idled on
 * `requires_action(submit_work_product)`. The SAME session keeps running —
 * the agent sees the feedback in its next turn, retries, and pauses again
 * with a fresh custom-tool-use id (which the next pollUntilIdle drains via
 * `persistPendingWorkProduct`). Caller queues `pollUntilIdle` in `after()`.
 */
export async function requestRevisionInSession(
  executionId: string,
  reviewerUserId: string,
  feedback: string,
  edits?: Record<string, unknown>,
): Promise<void> {
  const execution = await loadExecutionWithRelations(executionId);
  if (!execution.pendingCustomToolUseId) {
    throw new ValidationError(
      `Execution ${executionId} has no pendingCustomToolUseId — cannot request revision.`,
    );
  }
  if (execution.pendingCustomToolName !== SUBMIT_WORK_PRODUCT_TOOL_NAME) {
    throw new ValidationError(
      `Execution ${executionId} pendingCustomToolName is "${execution.pendingCustomToolName}", expected "${SUBMIT_WORK_PRODUCT_TOOL_NAME}".`,
    );
  }

  await resolveCustomToolCall(executionId, execution.pendingCustomToolUseId, {
    content: {
      accepted: false,
      feedback,
      reviewer: reviewerUserId,
      ...(edits ? { edits } : {}),
    },
  });

  // Flip back to PRODUCING + clear pending fields. The follow-up
  // pollUntilIdle (queued by the caller in after()) will drain the session
  // forward to its next requires_action / end_turn.
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "PRODUCING",
      externalStatus: "running",
      pendingCustomToolUseId: null,
      pendingCustomToolName: null,
    },
  });
}

/**
 * Phase 4: reject a pending submit_work_product. Best-effort tells the agent
 * the work product was rejected (so its transcript carries the reason),
 * interrupts the session, and archives it. The execution row's transition
 * to FAILED is handled by the legacy `reviewWorkProduct(reject)` path before
 * this is called — this helper only deals with the session side.
 */
export async function rejectWorkProductInSession(
  executionId: string,
  rejectedByUserId: string,
  reason?: string,
): Promise<void> {
  const execution = await loadExecutionWithRelations(executionId);
  if (!execution.externalSessionId) return;

  if (execution.pendingCustomToolUseId) {
    try {
      await resolveCustomToolCall(executionId, execution.pendingCustomToolUseId, {
        content: {
          accepted: false,
          rejected: true,
          reason: reason ?? "rejected by reviewer",
          reviewer: rejectedByUserId,
        },
      });
    } catch (err) {
      console.warn(
        `[managed-agents] rejectWorkProductInSession resolveCustomToolCall failed for ${executionId}:`,
        err,
      );
    }
  }

  await interruptSession(executionId);

  const orgId = execution.task.tactic.project.organizationId;
  if (orgId) {
    const apiKey = await loadAnthropicKey(orgId).catch(() => null);
    if (apiKey) {
      await archiveSession(execution.externalSessionId, apiKey);
    }
  }

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      pendingCustomToolUseId: null,
      pendingCustomToolName: null,
      externalStatus: "terminated",
    },
  });
}

async function finalizeFromSession(
  executionId: string,
  sessionId: string,
  apiKey: string,
  finalText: FinalTextCapture,
  success: boolean,
): Promise<void> {
  // Pull the full session so we can mirror usage + stats into telemetry.
  const full = await managedAgentsApi<SessionFull>(
    "GET",
    `/v1/sessions/${sessionId}${BETA_QS}`,
    undefined,
    apiKey,
  );

  const usage = full.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

  // Duration: prefer session.stats.active_seconds (model work), fall back to
  // duration_seconds (wall clock), else compute from the row's startedAt.
  const activeSec = full.stats?.active_seconds;
  const durationSec = full.stats?.duration_seconds;
  let durationMs =
    typeof activeSec === "number"
      ? Math.round(activeSec * 1000)
      : typeof durationSec === "number"
        ? Math.round(durationSec * 1000)
        : 0;

  if (durationMs === 0) {
    const row = await prisma.taskExecution.findUnique({
      where: { id: executionId },
      select: { startedAt: true },
    });
    if (row?.startedAt) durationMs = Date.now() - row.startedAt.getTime();
  }

  // Count tool-call events from the steps we just persisted.
  const toolCalls = await prisma.executionStep.count({
    where: { executionId, type: "TOOL_CALL" },
  });

  // Phase 4: there are three end-of-session shapes for the work-product path:
  //
  //   A. Custom-tool happy path: the agent called `marymary_submit_work_product`
  //      at some point, persistPendingWorkProduct already created the
  //      WorkProduct row, the human reviewed it, the row reached
  //      DELIVERING/COMPLETED, and the session resumed to end_turn purely so
  //      we can capture final telemetry. In this case we do NOT call
  //      `finalizeExecutionResult` — it would overwrite the row's status
  //      back to COMPLETED (and clobber a DELIVERY_FAILED state). We just
  //      mirror telemetry directly.
  //
  //   B. Defensive backstop: the agent reached end_turn without ever calling
  //      the custom tool (model regression, prompt drift). Fall back to
  //      parsing a fenced ```json block out of the last agent message,
  //      log a warn, and let `finalizeExecutionResult` create the WorkProduct
  //      row from the parsed payload as before.
  //
  //   C. No work product type at all: legacy non-typed flow, same as Phase 2.
  const row = await prisma.taskExecution.findUniqueOrThrow({
    where: { id: executionId },
    select: { workProductType: true, model: true },
  });
  const workProductType = row.workProductType;
  const outputText = finalText.lastAgentMessage ?? "";

  let workProductData: Record<string, unknown> | undefined;
  let alreadyHasWorkProduct = false;
  if (workProductType) {
    const existingCount = await prisma.workProduct.count({ where: { executionId } });
    if (existingCount > 0) {
      alreadyHasWorkProduct = true;
    } else if (outputText) {
      console.warn(
        `[managed-agents] session reached end_turn without marymary_submit_work_product call — falling back to extractJsonBlock for execution ${executionId}.`,
      );
      workProductData = extractJsonBlock(outputText);
    }
  }

  // Path A: telemetry-only update — leave row.status as-is.
  if (alreadyHasWorkProduct) {
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        output: { managed: true, sessionId } as Prisma.JsonObject,
        outputText,
        model: row.model ?? "managed-agents",
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        toolCalls,
      },
    });
    return;
  }

  // Mirror the agent's model onto the telemetry slot. Managed Agents don't
  // echo a "model used" on the session itself; fall back to whatever the
  // row already has (set from the agent definition at assign time). The
  // model + workProductType were already loaded above with the row.
  await finalizeExecutionResult(executionId, workProductType, {
    success: success && !finalText.lastErrorMessage,
    output: { managed: true, sessionId } as Record<string, unknown>,
    outputText,
    workProductData,
    telemetry: {
      model: row.model ?? "managed-agents",
      inputTokens,
      outputTokens,
      totalTokens,
      toolCalls,
    },
    durationMs,
  });
}

async function failExecution(executionId: string, error: string): Promise<void> {
  const row = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    select: { startedAt: true, status: true },
  });
  const durationMs = row?.startedAt ? Date.now() - row.startedAt.getTime() : undefined;
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  });
}

async function archiveSession(sessionId: string, apiKey: string): Promise<void> {
  try {
    await managedAgentsApi(
      "POST",
      `/v1/sessions/${sessionId}/archive${BETA_QS}`,
      undefined,
      apiKey,
    );
  } catch (err) {
    console.warn(`[managed-agents] archive failed for ${sessionId}:`, err);
  }
}

async function requireOpenSession(executionId: string): Promise<{
  sessionId: string;
  apiKey: string;
}> {
  const execution = await loadExecutionWithRelations(executionId);
  if (!execution.externalSessionId) {
    throw new ValidationError(`Execution ${executionId} has no externalSessionId`);
  }
  const orgId = execution.task.tactic.project.organizationId;
  if (!orgId) throw new ValidationError("Missing organization for execution");
  const apiKey = await loadAnthropicKey(orgId);
  return { sessionId: execution.externalSessionId, apiKey };
}

/**
 * Extract a JSON object out of a fenced ```json block. Falls back to parsing
 * the whole string if no fence is present. Returns `undefined` on any parse
 * failure — the caller treats missing work product data as "no structured
 * output", not as an execution error.
 */
function extractJsonBlock(text: string): Record<string, unknown> | undefined {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  try {
    const parsed = JSON.parse(candidate.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
