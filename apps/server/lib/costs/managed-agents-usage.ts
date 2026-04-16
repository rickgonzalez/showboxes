/**
 * Helper: fetch a Managed Agents session and project its usage into the
 * StageTokens shape used by the cost rollup.
 *
 * Called at the moment a session finishes — once for the triage session,
 * once for the analysis session. If the Managed Agents API is slow to
 * populate `usage`, this returns zeros rather than throwing; cost will
 * be under-reported but the pipeline won't break.
 */

import { managedAgentsApi, BETA_QS, type SessionFull } from '../managed-agents/client';
import type { StageTokens } from './prices';

export async function fetchSessionTokens(sessionId: string): Promise<StageTokens> {
  try {
    const session = await managedAgentsApi<SessionFull>(
      'GET',
      `/v1/sessions/${sessionId}${BETA_QS}`,
    );
    return {
      inputTokens: session.usage?.input_tokens ?? 0,
      outputTokens: session.usage?.output_tokens ?? 0,
      cacheReadInputTokens: session.usage?.cache_read_input_tokens ?? 0,
    };
  } catch (err) {
    // Don't fail the pipeline because we couldn't price a run; log and move on.
    console.warn(
      `[cost] failed to fetch session ${sessionId} usage:`,
      (err as Error).message,
    );
    return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
  }
}
