/**
 * Managed Agents HTTP client.
 *
 * Thin `fetch` wrapper around Anthropic's Managed Agents beta REST API.
 * Ported from reference/gnome-kit/agents/managed-agents/client.ts — the
 * original was battle-tested against the live beta in a sibling project.
 *
 * Why raw fetch: `@anthropic-ai/sdk` does not yet expose Managed Agents
 * resources as typed helpers. The fetch wrapper is ~50 lines and covers
 * everything we need.
 */

const API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Single beta header — covers Agents, Environments, Sessions, and Events.
 * Mutually exclusive with `agent-api-2026-03-01` (a different beta that
 * selects an incompatible API version).
 */
export const BETA_HEADER = 'managed-agents-2026-04-01';
export const BETA_QS = '?beta=true';

export interface ApiError extends Error {
  status: number;
  body: string;
}

// ── Type surface for the subset of endpoints we actually use ─────

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

export interface AgentCreateBody {
  name: string;
  model: string;
  system: string;
  metadata?: Record<string, string>;
  tools?: unknown[];
  mcp_servers?: unknown[];
  description?: string;
}

export interface SessionCreateBody {
  agent: string;
  environment_id: string;
  metadata?: Record<string, string>;
  title?: string | null;
}

export interface SessionFull {
  id: string;
  status?: string;
  environment_id?: string;
  agent?: { id: string; version?: number };
  metadata?: Record<string, string>;
  stats?: { active_seconds?: number; duration_seconds?: number };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface SessionStatusResponse {
  id: string;
  status: 'rescheduling' | 'running' | 'idle' | 'terminated' | string;
  stop_reason?: { type?: string; event_ids?: string[] } | null;
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

// ── Model resolver ───────────────────────────────────────────────

const LEGACY_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-5',
};
const KNOWN_GOOD_PREFIXES = [
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-opus-4-6',
];
const FALLBACK_MODEL = 'claude-sonnet-4-5';

export function resolveManagedAgentModel(input: string): string {
  if (LEGACY_MODEL_MAP[input]) return LEGACY_MODEL_MAP[input];
  if (KNOWN_GOOD_PREFIXES.some((p) => input.startsWith(p))) return input;
  return FALLBACK_MODEL;
}

// ── The one call that does all the work ──────────────────────────

export async function managedAgentsApi<T>(
  method: string,
  path: string,
  body?: unknown,
  apiKey?: string,
): Promise<T> {
  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!resolvedKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — required by managedAgentsApi().',
    );
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'x-api-key': resolvedKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': BETA_HEADER,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${res.statusText}\n${text}`,
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
