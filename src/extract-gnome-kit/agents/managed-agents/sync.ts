/**
 * Gnome → Managed Agent sync — Phases 1, 3, 4, 5.
 *
 * Idempotent helper that mirrors a marymary Gnome as an Anthropic Managed
 * Agents `Agent`. Called inline from `GnomeService.{create,update}Gnome` after
 * the DB write succeeds. Failures are captured in `Gnome.externalAgentError`
 * rather than thrown — gnome editing must not be coupled to beta uptime.
 *
 * Phase 1: system prompt + model only.
 * Phase 3: `marymary_submit_plan` custom tool for plan-review pauses.
 * Phase 4: `marymary_submit_work_product` custom tool for work-product review.
 * Phase 5: every ToolProvider in `gnome.toolProviders` is published as one or
 *          more custom tools by reading the platform-tools registry. Tool
 *          calls are dispatched server-side from `agent.session.service.ts`
 *          on `requires_action` events; credentials are loaded inline from
 *          `metrics-config.service.loadProjectCredentials`. The beta still
 *          does not support authenticated MCP servers (see §8c of the
 *          migration doc), so `mcp_servers` stays empty.
 */

import { prisma } from "@/lib/prisma";
import {
  managedAgentsApi,
  BETA_QS,
  resolveManagedAgentModel,
  type AgentResponse,
  type AgentCreateBody,
  type ApiError,
} from "./client";
import type { Gnome } from "@prisma/client";
import type { BuiltInGnomeData } from "@/agents/defaults";
import {
  EXECUTION_PLAN_JSON_SCHEMA,
  WORK_PRODUCT_SUBMISSION_JSON_SCHEMA,
  type ToolProviderType,
} from "@/agents/types";
import { getAllToolsForProviders } from "./platform-tools";

/**
 * Custom-tool name for the Phase 3 plan-review pause. Underscores only —
 * the Managed Agents beta's name regex rejects dots. Bumping this name will
 * orphan in-flight executions whose pendingCustomToolName column carries the
 * old value, so treat it as a versioned identifier.
 */
export const SUBMIT_PLAN_TOOL_NAME = "marymary_submit_plan";

/**
 * Custom-tool name for the Phase 4 work-product submission pause. Same
 * naming rules as SUBMIT_PLAN_TOOL_NAME. Reusing the same `pendingCustomTool*`
 * columns added in Phase 3 — the `pendingCustomToolName` discriminator tells
 * the resume path which tool to look for.
 */
export const SUBMIT_WORK_PRODUCT_TOOL_NAME = "marymary_submit_work_product";

/** Custom-tool definition body for `agents.tools[]`. */
function submitPlanCustomTool() {
  return {
    type: "custom" as const,
    name: SUBMIT_PLAN_TOOL_NAME,
    description:
      "Submit your proposed execution plan for human review before taking " +
      "any side-effectful actions. The session will pause until the reviewer " +
      "approves or rejects. The custom_tool_result you receive will be a " +
      "JSON object with `approved: boolean` and (on rejection) `reason`. " +
      "Do not call this tool more than once per session.",
    input_schema: EXECUTION_PLAN_JSON_SCHEMA,
  };
}

/**
 * Phase 4: custom tool the agent calls to submit a finished work product
 * (e.g. a linkedin-post payload). The session pauses on `requires_action`
 * exactly the way submit_plan does, marymary opens a WORK_REVIEW row, and
 * the human review action resolves this tool call:
 *   - approve  → `{accepted: true}` → session continues to end_turn
 *   - revise   → `{accepted: false, feedback}` → SAME session keeps running,
 *                agent retries in the next turn, calls the tool again
 *   - reject   → `{accepted: false, rejected: true}` → session interrupted
 *
 * The `data` schema is intentionally generic (`type: "object"`); the
 * per-task work-product schema travels through the initial user message.
 * See WORK_PRODUCT_SUBMISSION_JSON_SCHEMA for the additionalProperties gotcha.
 */
function submitWorkProductCustomTool() {
  return {
    type: "custom" as const,
    name: SUBMIT_WORK_PRODUCT_TOOL_NAME,
    description:
      "Submit your finished work product for human review. The `data` " +
      "object MUST conform to the JSON Schema provided in the initial user " +
      "message under '── Work product specification ──'. The session will " +
      "pause until the reviewer accepts or sends back feedback. The " +
      "custom_tool_result you receive will be a JSON object: if `accepted` " +
      "is true, you are done — return a brief confirmation message and " +
      "stop. If `accepted` is false, the result includes `feedback` — " +
      "incorporate it and call this tool again with a revised payload.",
    input_schema: WORK_PRODUCT_SUBMISSION_JSON_SCHEMA,
  };
}

export type SyncResult =
  | { ok: true; externalAgentId: string; externalAgentVersion: number }
  | { ok: false; error: string };

/**
 * Build the POST body sent to `/v1/agents`. Shared by the DB-gnome and
 * built-in code paths so they always produce identical Agents.
 *
 * Tool wiring:
 *   - Phase 3: gnomes whose `canAutoExecute === false` get
 *     `marymary_submit_plan` for plan-review pauses.
 *   - Phase 4: gnomes whose `producibleWorkProducts.length > 0` get
 *     `marymary_submit_work_product` for work-product review pauses.
 *     This is independent of `canAutoExecute` — auto-execute gnomes still
 *     produce typed work products; the auto-execute flag only governs the
 *     plan gate.
 *   - Phase 5: every PlatformTool whose `provider` is in
 *     `gnome.toolProviders` is appended as a custom tool. Names MUST NOT
 *     collide with the two reserved Phase 3/4 names — the guard below throws
 *     at sync time so the seed/sync run fails loudly if a provider file
 *     accidentally registers a colliding tool.
 *
 * Auto-execute gnomes that produce no work products and have no tool
 * providers end up with an empty `tools` array — auto-execution with no
 * typed output and no platform tools is the absence of any gating or wiring.
 */
function buildAgentBody(args: {
  slug: string;
  defaultModel: string;
  systemPromptTemplate: string;
  canAutoExecute: boolean;
  producibleWorkProducts: string[];
  toolProviders: ToolProviderType[];
  metadata: Record<string, string>;
}): AgentCreateBody {
  type CustomToolEntry = {
    type: "custom";
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  const tools: CustomToolEntry[] = [];
  if (!args.canAutoExecute) {
    tools.push(submitPlanCustomTool());
  }
  if (args.producibleWorkProducts.length > 0) {
    tools.push(submitWorkProductCustomTool());
  }

  // Phase 5: append every platform tool whose provider is on this gnome.
  // Order is registration order from `platform-tools/index.ts`, which is
  // stable across runs — the seed script won't churn version bumps.
  for (const platformTool of getAllToolsForProviders(args.toolProviders)) {
    if (
      platformTool.name === SUBMIT_PLAN_TOOL_NAME ||
      platformTool.name === SUBMIT_WORK_PRODUCT_TOOL_NAME
    ) {
      throw new Error(
        `Platform tool name "${platformTool.name}" collides with reserved ` +
          `custom tool. Rename the platform tool or pick a different reserved name.`,
      );
    }
    tools.push({
      type: "custom",
      name: platformTool.name,
      description: platformTool.description,
      input_schema: platformTool.inputSchema,
    });
  }

  return {
    name: args.slug,
    // Translate legacy Messages-API model IDs (e.g. claude-sonnet-4-20250514)
    // into a Managed Agents-supported equivalent. The legacy harness keeps
    // using whatever the gnome row says; only the remote Agent gets the
    // translated value.
    model: resolveManagedAgentModel(args.defaultModel),
    // Phase 1 uses the raw template. Handlebars context (project, tactic,
    // task vars) is per-session and lands in Phase 2 via the initial
    // user.message inside agent.session.service.ts.
    system: args.systemPromptTemplate,
    metadata: args.metadata,
    tools,
    mcp_servers: [],
  };
}

/**
 * Create-or-update the remote Agent for a DB-backed Gnome and persist the
 * result columns. Never throws — failures are written to `externalAgentError`.
 */
export async function syncGnomeToManagedAgent(gnomeId: string): Promise<SyncResult> {
  const gnome = await prisma.gnome.findUnique({ where: { id: gnomeId } });
  if (!gnome) {
    return { ok: false, error: `Gnome ${gnomeId} not found` };
  }

  const body = buildAgentBody({
    slug: gnome.slug,
    defaultModel: gnome.defaultModel,
    systemPromptTemplate: gnome.systemPromptTemplate,
    canAutoExecute: gnome.canAutoExecute,
    producibleWorkProducts: gnome.producibleWorkProducts,
    toolProviders: gnome.toolProviders as ToolProviderType[],
    metadata: {
      gnomeId: gnome.id,
      source: "marymary",
      scope: gnome.projectId ? "project" : gnome.organizationId ? "org" : "unknown",
    },
  });

  try {
    const agent = await upsertRemoteAgent(gnome.externalAgentId, body);
    await prisma.gnome.update({
      where: { id: gnome.id },
      data: {
        externalAgentId: agent.id,
        externalAgentVersion: agent.version ?? null,
        externalAgentSyncedAt: new Date(),
        externalAgentError: null,
      },
    });
    return {
      ok: true,
      externalAgentId: agent.id,
      externalAgentVersion: agent.version ?? 0,
    };
  } catch (err) {
    const message = formatSyncError(err);
    // Best-effort error capture. If even this update fails (DB outage), we
    // log and return the original error so the caller still sees it.
    try {
      await prisma.gnome.update({
        where: { id: gnome.id },
        data: { externalAgentError: message.slice(0, 1000) },
      });
    } catch (writeErr) {
      console.warn(
        `[managed-agents] failed to record sync error for gnome ${gnome.id}:`,
        writeErr
      );
    }
    console.warn(
      `[managed-agents] sync failed for gnome ${gnome.id} (${gnome.slug}): ${message}`
    );
    return { ok: false, error: message };
  }
}

/**
 * Variant for built-in gnomes (no DB row). Used by the seed script. Returns
 * the remote Agent ID + version directly; the caller is responsible for
 * persisting it (the seed script writes the slug→id map to
 * `builtin-registry.json`).
 */
export async function syncBuiltInGnomeToManagedAgent(
  builtIn: BuiltInGnomeData,
  existingExternalAgentId: string | null
): Promise<SyncResult> {
  const body = buildAgentBody({
    slug: builtIn.slug,
    defaultModel: builtIn.defaultModel,
    systemPromptTemplate: builtIn.systemPromptTemplate,
    canAutoExecute: builtIn.canAutoExecute,
    producibleWorkProducts: builtIn.producibleWorkProducts,
    toolProviders: builtIn.toolProviders,
    metadata: {
      builtInSlug: builtIn.slug,
      source: "marymary",
      scope: "builtin",
    },
  });

  try {
    const agent = await upsertRemoteAgent(existingExternalAgentId, body);
    return {
      ok: true,
      externalAgentId: agent.id,
      externalAgentVersion: agent.version ?? 0,
    };
  } catch (err) {
    return { ok: false, error: formatSyncError(err) };
  }
}

/**
 * POST `/v1/agents` if no external ID is known, otherwise GET the existing
 * Agent for its current `version` (optimistic-concurrency token) and POST
 * `/v1/agents/{id}` with that version included. The update endpoint rejects
 * the request if the version doesn't match the server's current value, so we
 * always re-read it right before updating.
 */
async function upsertRemoteAgent(
  existingId: string | null,
  body: AgentCreateBody
): Promise<AgentResponse> {
  if (!existingId) {
    return managedAgentsApi<AgentResponse>("POST", `/v1/agents${BETA_QS}`, body);
  }

  const current = await managedAgentsApi<AgentResponse>(
    "GET",
    `/v1/agents/${existingId}${BETA_QS}`
  );
  const updateBody = { ...body, version: current.version ?? 1 };
  return managedAgentsApi<AgentResponse>(
    "POST",
    `/v1/agents/${existingId}${BETA_QS}`,
    updateBody
  );
}

function formatSyncError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as Partial<ApiError> & Error;
    return e.status ? `[${e.status}] ${e.message}` : e.message;
  }
  return String(err);
}

// Re-exported so call sites only need to import from this module.
export type { Gnome };
