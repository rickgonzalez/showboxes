/**
 * Session driver — open a Managed Agents session against the code-analysis
 * gnome and run it to completion.
 *
 * Flow:
 *   1. POST /v1/sessions → get session.id
 *   2. POST /v1/sessions/:id/events with { type: "user.message", content: [...] }
 *   3. Poll /v1/sessions/:id/events until we see `agent.custom_tool_use`
 *      for `submit_code_analysis` — pull the structured input as the result.
 *   4. Resolve the tool call with `user.custom_tool_result { accepted: true }`.
 *   5. Poll until `session.status_idle { stop_reason: end_turn }`.
 *
 * Greatly slimmed from reference/gnome-kit/services/agent.session.service.ts
 * — that file drove the entire marymary plan/approve/revision loop. For
 * showboxes we have one tool and one shot.
 */

import {
  managedAgentsApi,
  BETA_QS,
  type SessionFull,
  type SessionEvent,
  type EventsResponse,
} from '../managed-agents/client';
import { SUBMIT_CODE_ANALYSIS_TOOL_NAME } from './submit-code-analysis.tool';
import type { AnalysisJSON } from '@showboxes/shared-types';

// Poll knobs. Analysis typically runs 60–120s; we poll every 3s so we don't
// hammer the API but also don't add minutes of latency to short runs.
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200; // ~10 minutes hard ceiling

export interface StartSessionInput {
  agentExternalId: string;
  environmentExternalId: string;
  userMessage: string;
  metadata?: Record<string, string>;
}

export interface SessionRunResult {
  sessionId: string;
  analysis: AnalysisJSON;
}

export interface StartSessionResult {
  sessionId: string;
}

/**
 * Create a session and post the initial user message. Returns as soon as
 * the message is accepted — does NOT wait for the agent to finish. Call
 * `runSessionToCompletion` (or the bg equivalent via `after()`) to drive
 * it to completion.
 */
export async function startSession(
  input: StartSessionInput,
): Promise<StartSessionResult> {
  const session = await managedAgentsApi<SessionFull>(
    'POST',
    `/v1/sessions${BETA_QS}`,
    {
      agent: input.agentExternalId,
      environment_id: input.environmentExternalId,
      metadata: input.metadata,
    },
  );

  if (!session.id) {
    throw new Error('Session create returned no id');
  }

  await managedAgentsApi<unknown>(
    'POST',
    `/v1/sessions/${session.id}/events${BETA_QS}`,
    {
      events: [
        {
          type: 'user.message',
          content: [{ type: 'text', text: input.userMessage }],
        },
      ],
    },
  );

  return { sessionId: session.id };
}

/**
 * Poll a session until the agent calls `submit_code_analysis`, harvest the
 * structured output, resolve the tool call, and wait for end_turn.
 *
 * Throws on timeout or if the session terminates with an error.
 */
export async function runSessionToCompletion(
  sessionId: string,
): Promise<SessionRunResult> {
  let nextPage: string | null = null;
  let pendingToolUseId: string | null = null;
  let analysis: AnalysisJSON | null = null;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const qs: string = nextPage
      ? `${BETA_QS}&order=asc&page=${encodeURIComponent(nextPage)}`
      : `${BETA_QS}&order=asc`;

    const res: EventsResponse = await managedAgentsApi<EventsResponse>(
      'GET',
      `/v1/sessions/${sessionId}/events${qs}`,
    );

    for (const evt of res.data as SessionEvent[]) {
      if (evt.type === 'agent.custom_tool_use') {
        // Beta event shape: { id, type, name, input: { payload: {...} }, processed_at? }
        const e = evt as SessionEvent & {
          name?: string;
          input?: { payload?: unknown };
          processed_at?: string | null;
        };
        if (e.name === SUBMIT_CODE_ANALYSIS_TOOL_NAME) {
          pendingToolUseId = evt.id;
          analysis = (e.input?.payload ?? e.input) as AnalysisJSON;
          // If the beta already auto-resolved this call, don't try to
          // resolve it again — we'd get a 4xx.
          if (e.processed_at) {
            pendingToolUseId = null;
          }
        }
      }

      if (evt.type === 'session.status_idle') {
        const e = evt as SessionEvent & { stop_reason?: { type?: string } };
        if (e.stop_reason?.type === 'retries_exhausted') {
          throw new Error(
            `Session ${sessionId} terminated: retries_exhausted`,
          );
        }
        // `end_turn` and `requires_action` both mean "we can ship now
        // if we have the payload" — the exit check below handles it.
      }

      if (evt.type === 'session.status_terminated') {
        throw new Error(`Session ${sessionId} terminated unexpectedly`);
      }
    }

    // If we captured a pending submit_code_analysis call but haven't
    // resolved it yet, resolve it now. If the resolve fails we still
    // have the analysis payload, which is what we actually need.
    let resolved = false;
    if (pendingToolUseId && analysis) {
      try {
        await resolveCustomToolCall(sessionId, pendingToolUseId, {
          accepted: true,
          message: 'Analysis received.',
        });
        resolved = true;
      } catch (e) {
        console.warn(
          `[session ${sessionId}] resolve failed (non-fatal, we have the payload):`,
          (e as Error).message,
        );
      }
      pendingToolUseId = null;
    }

    // We're done the moment we have the analysis. `end_turn` is nice
    // to wait for, but the payload IS the deliverable — if the beta
    // auto-processed the tool call or we successfully resolved it,
    // ship the result.
    if (analysis) {
      return { sessionId, analysis };
    }

    nextPage = res.next_page ?? null;
    if (!resolved) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Session ${sessionId} did not complete after ${MAX_POLL_ATTEMPTS} polls`,
  );
}

async function resolveCustomToolCall(
  sessionId: string,
  customToolUseId: string,
  result: unknown,
): Promise<void> {
  await managedAgentsApi<unknown>(
    'POST',
    `/v1/sessions/${sessionId}/events${BETA_QS}`,
    {
      events: [
        {
          type: 'user.custom_tool_result',
          custom_tool_use_id: customToolUseId,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        },
      ],
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
