/**
 * Managed Agents HTTP client — Phase 1.
 *
 * Thin `fetch` wrapper around Anthropic's Managed Agents beta REST API.
 * Extracted from `scripts/managed-agents-smoke.ts` so that the same helper
 * powers both the smoke canary and the gnome-sync code path.
 *
 * Why raw fetch instead of the SDK: `@anthropic-ai/sdk` is pinned at ^0.80.0
 * and does not yet expose Managed Agents resources. Bumping it would force a
 * cascade of edits in `agent.service.ts` and `src/agents/execution/*` which
 * Phase 1 explicitly does not touch.
 *
 * Auth model:
 *   - Phase 1 callers (`sync.ts`, seed script, smoke script) continue to call
 *     `managedAgentsApi(method, path, body)` with no `apiKey` arg and get the
 *     value from `process.env.ANTHROPIC_API_KEY`.
 *   - Phase 2 execution callers (`agent.session.service.ts`) pass the per-org
 *     decrypted key explicitly via the 4-arg form. Sessions are user-triggered
 *     and must charge against the right org's key — Phase 1 provisioning,
 *     which is developer-script-grade, did not need this distinction.
 */

const API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Single beta header. The SDK source confirms this covers Agents,
 * Environments, and Sessions. The standalone `agent-api-2026-03-01` beta is
 * mutually exclusive with `managed-agents-*` and selects an incompatible API
 * version, so we never combine them.
 */
export const BETA_HEADER = "managed-agents-2026-04-01";

/**
 * All Managed Agents endpoints take a `?beta=true` query string in addition
 * to the `anthropic-beta` header — see the SDK's resources/beta/(agents|sessions|environments)
 * modules. Helper for callers that need to append additional query params.
 */
export const BETA_QS = "?beta=true";

export interface ApiError extends Error {
  status: number;
  body: string;
}

export interface EnvironmentResponse {
  id: string;
  name?: string;
  description?: string;
}

export interface AgentResponse {
  id: string;
  version?: number;
  name?: string;
  model?: string;
}

/**
 * Map a marymary gnome's `defaultModel` (which can still hold legacy
 * Messages-API model IDs the existing harness uses) to a model ID the
 * Managed Agents beta accepts. Probed against the live beta on 2026-04-10:
 * `claude-sonnet-4-20250514` is rejected; `claude-{sonnet,haiku,opus}-4-5/4-6`
 * variants are accepted. Any unknown ID falls through to a safe sonnet
 * default rather than blowing up — Phase 1 isn't actually executing against
 * these Agents yet, so a slight model swap is harmless.
 */
const LEGACY_MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-20250514": "claude-sonnet-4-5",
};
const KNOWN_GOOD_PREFIXES = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-5",
  "claude-opus-4-6",
];
const FALLBACK_MODEL = "claude-sonnet-4-5";

export function resolveManagedAgentModel(input: string): string {
  if (LEGACY_MODEL_MAP[input]) return LEGACY_MODEL_MAP[input];
  if (KNOWN_GOOD_PREFIXES.some((p) => input.startsWith(p))) return input;
  return FALLBACK_MODEL;
}

/**
 * Body shape for `POST /v1/agents?beta=true`. Phase 1 always passes empty
 * `tools` and `mcp_servers`; the beta does not yet accept authenticated MCP
 * servers, so wiring marymary's Clerk-protected MCP is descoped from this
 * phase.
 */
export interface AgentCreateBody {
  name: string;
  model: string;
  system: string;
  metadata?: Record<string, string>;
  tools?: unknown[];
  mcp_servers?: unknown[];
  description?: string;
}

export interface SessionResponse {
  id: string;
  status?: string;
  environment_id?: string;
}

/**
 * Body for `POST /v1/sessions?beta=true`. Per the SDK type `SessionCreateParams`
 * there is no `initial_messages` field — sessions are created empty and the
 * first `user.message` is POSTed as a separate event (see
 * `scripts/managed-agents-smoke.ts` for the reference sequence).
 *
 * `metadata` values MUST be strings — the SDK types it as
 * `Record<string, string>` with a limit of 16 pairs, keys ≤64 chars,
 * values ≤512 chars. Coerce anything numeric on the caller side.
 */
export interface SessionCreateBody {
  agent: string;
  environment_id: string;
  metadata?: Record<string, string>;
  title?: string | null;
}

/**
 * Full session shape returned by create/get/archive. Includes cumulative
 * usage and stats fields which Phase 2's event hydrator mirrors into
 * `TaskExecution.inputTokens`/`outputTokens`/`totalTokens`/`durationMs`.
 */
export interface SessionFull extends SessionResponse {
  agent?: { id: string; version?: number };
  metadata?: Record<string, string>;
  stats?: { active_seconds?: number; duration_seconds?: number };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
}

export interface SessionEvent {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface EventsResponse {
  data: SessionEvent[];
  has_more?: boolean;
  next_page?: string | null;
}

/**
 * Shape of `session.status_idle` events' `stop_reason`. When
 * `type === "requires_action"` the session is blocked on one or more
 * pending events (custom tool use, tool confirmation). Phase 2 doesn't
 * yet emit custom tools, so in practice we only see `end_turn` and the
 * error variants.
 */
export interface SessionStatusIdleStopReason {
  type: "end_turn" | "requires_action" | "retries_exhausted";
  event_ids?: string[];
}

export interface SessionStatusResponse {
  id: string;
  status: "rescheduling" | "running" | "idle" | "terminated" | string;
  stop_reason?: { type?: string } | null;
}

/**
 * Issue a request against the Managed Agents beta. `path` should already
 * include the `?beta=true` query string (use `BETA_QS`); appending additional
 * params is the caller's responsibility.
 *
 * Pass `apiKey` explicitly for Phase 2 execution calls that must use a
 * per-org decrypted key (see `agent.session.service.ts`). Omit it for Phase 1
 * provisioning callers (`sync.ts`, seed/smoke scripts) that still read from
 * `process.env.ANTHROPIC_API_KEY`.
 *
 * On non-2xx, throws an `ApiError` whose `.message` includes the response
 * body so beta-side surprises are visible in logs without an extra fetch.
 */
export async function managedAgentsApi<T>(
  method: string,
  path: string,
  body?: unknown,
  apiKey?: string
): Promise<T> {
  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!resolvedKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — required by managedAgentsApi(). " +
        "Either pass it explicitly (Phase 2 execution path) or export it " +
        "in your shell / .env (Phase 1 provisioning scripts)."
    );
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "x-api-key": resolvedKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": BETA_HEADER,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${res.statusText}\n${text}`
    ) as ApiError;
    err.status = res.status;
    err.body = text;
    throw err;
  }

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${method} ${path} → 2xx but body was not JSON:\n${text}`);
  }
}
