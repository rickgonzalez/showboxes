/**
 * Find all Analysis rows still in 'running' and try to resolve them
 * against the Managed Agents session. Useful after shipping a bug fix
 * that unblocks previously-stuck sessions.
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

async function recoverRow(row: { id: string; sessionId: string | null }) {
  if (!row.sessionId) {
    console.log(`  skip (no sessionId)`);
    return;
  }
  let nextPage: string | null = null;
  let pendingId: string | null = null;
  let analysis: AnalysisJSON | null = null;
  for (let i = 0; i < 20; i++) {
    const qs: string = nextPage
      ? `${BETA_QS}&order=asc&page=${encodeURIComponent(nextPage)}`
      : `${BETA_QS}&order=asc`;
    const res: EventsResponse = await managedAgentsApi<EventsResponse>(
      'GET',
      `/v1/sessions/${row.sessionId}/events${qs}`,
    );
    for (const evt of res.data as SessionEvent[]) {
      if (evt.type === 'agent.custom_tool_use') {
        const e = evt as SessionEvent & {
          name?: string;
          input?: { payload?: unknown };
          processed_at?: string | null;
        };
        if (e.name === SUBMIT_CODE_ANALYSIS_TOOL_NAME) {
          pendingId = e.processed_at ? null : evt.id;
          analysis = (e.input?.payload ?? e.input) as AnalysisJSON;
        }
      }
    }
    if (!res.has_more) break;
    nextPage = res.next_page ?? null;
    if (!nextPage) break;
  }

  if (!analysis) {
    console.log(`  no submit_code_analysis yet — session still running`);
    return;
  }

  if (pendingId) {
    try {
      await managedAgentsApi<unknown>(
        'POST',
        `/v1/sessions/${row.sessionId}/events${BETA_QS}`,
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
      console.log(`  resolved pending tool use`);
    } catch (e) {
      console.log(`  resolve failed (non-fatal): ${(e as Error).message}`);
    }
  }
  await prisma.analysis.update({
    where: { id: row.id },
    data: { status: 'ready', data: analysis as unknown as object },
  });
  console.log(`  wrote analysis (${Object.keys(analysis).length} keys)`);
}

async function main() {
  const running = await prisma.analysis.findMany({
    where: { status: 'running' },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${running.length} running row(s) to check`);
  for (const row of running) {
    console.log(`\n— ${row.id}  session ${row.sessionId ?? '(none)'}`);
    try {
      await recoverRow(row);
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
