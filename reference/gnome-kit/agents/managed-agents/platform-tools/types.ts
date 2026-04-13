/**
 * Phase 5 — Platform tool transport for the Managed Agents path.
 *
 * `PlatformTool` is the runtime shape that the Phase 5 dispatcher
 * (`agent.session.service.ts → dispatchPlatformToolCall`) speaks. Each
 * provider file under `./providers/*.ts` registers one or more of these into
 * the module-scoped registry; `sync.ts → buildAgentBody` reads the same
 * registry to publish the corresponding `tools[]` entries on the remote
 * Managed Agent.
 *
 * Why a new interface instead of reusing `ToolProvider` from `agents/types.ts`:
 *   - Legacy `ToolProvider.resolveTools(creds)` returns a closure that has
 *     credentials baked in. The Managed Agents path resolves tools statically
 *     at sync time (no creds yet) and supplies credentials per-call via
 *     `PlatformToolContext` at dispatch time. Two distinct lifecycles → two
 *     interfaces.
 *   - We need `inputSchema` to be the raw JSON Schema with NO
 *     `additionalProperties` at any depth — the Managed Agents beta rejects
 *     custom tool schemas that declare it (see EXECUTION_PLAN_JSON_SCHEMA in
 *     `agents/types.ts` for the same gotcha). Keeping a separate interface
 *     means we don't accidentally inherit the legacy `input_schema` shape that
 *     might one day grow such a field.
 *   - `provider` is on the tool itself, not on a wrapping object. This lets
 *     the registry lookup-by-provider-list be a single map iteration in
 *     `getAllToolsForProviders`.
 */

import type { MetricSource, PrismaClient } from "@prisma/client";
import type { ToolProviderType } from "@/agents/types";

/**
 * Per-call context the dispatcher hands to a `PlatformTool.execute`. All
 * required IDs are pre-resolved from the `TaskExecution` row so individual
 * tool implementations don't have to re-query Prisma for the basics.
 *
 * `credentials` / `credentialsMeta` are populated only when the tool declares
 * a non-empty `requiredSources` AND a matching `MetricsConfig` row was found.
 * Credential-less built-ins (web_search, media_library, ai_image_generation)
 * receive `undefined` for both.
 */
export interface PlatformToolContext {
  executionId: string;
  taskId: string;
  tacticId: string;
  projectId: string;
  projectSlug: string;
  organizationId: string | null;
  /** Decrypted credentials for this tool's primary required source. */
  credentials?: Record<string, unknown>;
  /** Non-secret metadata stored alongside the credentials (e.g. propertyId). */
  credentialsMeta?: Record<string, unknown>;
  /** Shared Prisma client — passed in so individual tools don't import it. */
  prisma: PrismaClient;
}

/**
 * A platform tool registered against the Managed Agents path. The dispatcher
 * looks tools up by `name` (the same string passed in `agent.custom_tool_use`
 * events). The registry also indexes by `provider` so `buildAgentBody` can
 * filter to just the tools a gnome's `toolProviders` array opted into.
 */
export interface PlatformTool {
  /**
   * Tool name as registered with the remote Managed Agent. Underscores only —
   * the beta's name regex rejects dots. MUST be unique across the registry
   * and MUST NOT collide with `marymary_submit_plan` or
   * `marymary_submit_work_product`.
   */
  name: string;
  description: string;
  /**
   * Raw JSON Schema for the tool input. Critical: must NOT contain
   * `additionalProperties` at any depth. The unit test in `registry.test.ts`
   * walks the schema tree and fails the build if it finds one.
   */
  inputSchema: Record<string, unknown>;
  /**
   * Which `MetricSource`(s) the tool needs credentials for. Empty for the
   * three credential-less built-in groups (web_search, media_library,
   * ai_image_generation). The dispatcher looks at the FIRST entry only when
   * deciding which `MetricsConfig` row to load — multi-source tools are
   * out of scope for Phase 5.
   */
  requiredSources: MetricSource[];
  /**
   * Informational only in Phase 5 — gating for side-effect tools (e.g.
   * twitter_post) is deferred to Phase 6 once we know what the UX should look
   * like. Today every tool registered here runs without an approval gate.
   */
  hasSideEffects: boolean;
  /**
   * Which logical provider this tool belongs to. The dispatcher uses
   * `getAllToolsForProviders(gnome.toolProviders)` to figure out which tools
   * appear on each gnome's remote Agent.
   */
  provider: ToolProviderType;
  /**
   * The actual tool implementation. Receives the validated input from the
   * agent and the per-call context. Throws are caught by the dispatcher and
   * resolved as `{ error: "execute_threw", message }, isError: true` so the
   * agent can adapt in-session.
   */
  execute: (
    input: Record<string, unknown>,
    ctx: PlatformToolContext,
  ) => Promise<unknown>;
}
