/**
 * One-shot resolver: given a session id, find the pending custom_tool_use
 * event, post a user.custom_tool_result, and write the analysis into the
 * DB row. Lets us recover a run that got stuck due to the original bug
 * in runSessionToCompletion.
 */

import { prisma } from '../lib/prisma';
import {
  managedAgentsApi,
  BETA_QS,
  type EventsResponse,
  type SessionEvent,
} from '../lib/managed-agents/client';
import { SUBMIT_CODE_ANALYSIS_TOOL_NAME } from '../lib/agents/submit-code-analysis.tool';
import type { AnalysisJSON } from '@showboxes/shared-types';

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('usage: tsx scripts/resolve-pending.ts <sessionId>');
    process.exit(1);
  }

  // 1. Walk the full event stream to find the custom_tool_use.
  let nextPage: string | null = null;
  let pendingId: string | null = null;
  let analysis: AnalysisJSON | null = null;
  for (let i = 0; i < 20; i++) {
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
        };
        if (e.name === SUBMIT_CODE_ANALYSIS_TOOL_NAME) {
          pendingId = evt.id;
          analysis = (e.input?.payload ?? e.input) as AnalysisJSON;
        }
      }
    }
    if (!res.has_more) break;
    nextPage = res.next_page ?? null;
    if (!nextPage) break;
  }

  if (!pendingId || !analysis) {
    console.error('no pending submit_code_analysis found');
    process.exit(2);
  }
  console.log(`found pending tool use ${pendingId}`);
  console.log(`analysis has ${Object.keys(analysis).length} top-level keys`);

  // 2. Try resolving it.
  try {
    await managedAgentsApi<unknown>(
      'POST',
      `/v1/sessions/${sessionId}/events${BETA_QS}`,
      {
        events: [
          {
            type: 'user.custom_tool_result',
            custom_tool_use_id: pendingId,
            content: [{ type: 'text', text: JSON.stringify({ accepted: true }) }],
          },
        ],
      },
    );
    console.log('resolve OK');
  } catch (e) {
    console.error('resolve FAILED:', (e as Error).message);
  }

  // 3. Write analysis to DB.
  const row = await prisma.analysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) {
    console.error('no matching Analysis row');
    process.exit(3);
  }
  await prisma.analysis.update({
    where: { id: row.id },
    data: { status: 'ready', data: analysis as unknown as object },
  });
  console.log(`wrote analysis to row ${row.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
