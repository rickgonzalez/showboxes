/**
 * Triage session driver — open a Managed Agents session against the
 * code-triage gnome and run it to completion.
 *
 * Narrower than session.ts:
 *  - Only waits for `submit_triage`
 *  - Shorter poll ceiling (triage should finish in <60s)
 *  - Returns a TriageReport
 */

import {
  managedAgentsApi,
  BETA_QS,
  type SessionFull,
  type SessionEvent,
  type EventsResponse,
} from '../managed-agents/client';
import { SUBMIT_TRIAGE_TOOL_NAME } from './submit-triage.tool';
import type { TriageReport } from '@showboxes/shared-types';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // ~3 minutes — triage should finish in <60s

export interface StartTriageSessionInput {
  agentExternalId: string;
  environmentExternalId: string;
  userMessage: string;
  metadata?: Record<string, string>;
}

export interface TriageSessionResult {
  sessionId: string;
  report: TriageReport;
}

export async function startTriageSession(
  input: StartTriageSessionInput,
): Promise<{ sessionId: string }> {
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
    throw new Error('Triage session create returned no id');
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

export async function runTriageSessionToCompletion(
  sessionId: string,
): Promise<TriageSessionResult> {
  let nextPage: string | null = null;
  let pendingToolUseId: string | null = null;
  let report: TriageReport | null = null;

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
        const e = evt as SessionEvent & {
          name?: string;
          input?: { payload?: unknown };
          processed_at?: string | null;
        };
        if (e.name === SUBMIT_TRIAGE_TOOL_NAME) {
          pendingToolUseId = evt.id;
          report = (e.input?.payload ?? e.input) as TriageReport;
          if (e.processed_at) {
            pendingToolUseId = null;
          }
        }
      }

      if (evt.type === 'session.status_idle') {
        const e = evt as SessionEvent & { stop_reason?: { type?: string } };
        if (e.stop_reason?.type === 'retries_exhausted') {
          throw new Error(
            `Triage session ${sessionId} terminated: retries_exhausted`,
          );
        }
      }

      if (evt.type === 'session.status_terminated') {
        throw new Error(
          `Triage session ${sessionId} terminated unexpectedly`,
        );
      }
    }

    let resolved = false;
    if (pendingToolUseId && report) {
      try {
        await managedAgentsApi<unknown>(
          'POST',
          `/v1/sessions/${sessionId}/events${BETA_QS}`,
          {
            events: [
              {
                type: 'user.custom_tool_result',
                custom_tool_use_id: pendingToolUseId,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ accepted: true }),
                  },
                ],
              },
            ],
          },
        );
        resolved = true;
      } catch (e) {
        console.warn(
          `[triage ${sessionId}] resolve failed (non-fatal):`,
          (e as Error).message,
        );
      }
      pendingToolUseId = null;
    }

    if (report) {
      return { sessionId, report };
    }

    nextPage = res.next_page ?? null;
    if (!resolved) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  throw new Error(
    `Triage session ${sessionId} did not complete after ${MAX_POLL_ATTEMPTS} polls`,
  );
}
