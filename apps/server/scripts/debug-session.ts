/**
 * Debug helper — print the raw events for a session + the matching
 * Analysis row. Run with: `npx tsx scripts/debug-session.ts <sessionId>`
 * (needs `tsx` installed globally or via npx).
 */

import { prisma } from '../lib/prisma';
import { managedAgentsApi, BETA_QS, type EventsResponse } from '../lib/managed-agents/client';

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('usage: tsx scripts/debug-session.ts <sessionId>');
    process.exit(1);
  }

  const row = await prisma.analysis.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });
  console.log('── Analysis row ──');
  console.log(JSON.stringify(row, null, 2));

  console.log('\n── Session events ──');
  let nextPage: string | null = null;
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const qs: string = nextPage
      ? `${BETA_QS}&order=asc&page=${encodeURIComponent(nextPage)}`
      : `${BETA_QS}&order=asc`;
    const res: EventsResponse = await managedAgentsApi<EventsResponse>(
      'GET',
      `/v1/sessions/${sessionId}/events${qs}`,
    );
    for (const evt of res.data) {
      total++;
      const summary: Record<string, unknown> = {
        id: evt.id,
        type: evt.type,
      };
      if ('tool_name' in evt) summary.tool_name = evt.tool_name;
      if ('stop_reason' in evt) summary.stop_reason = evt.stop_reason;
      if ('status' in evt) summary.status = evt.status;
      console.log(JSON.stringify(summary));
    }
    if (!res.has_more) break;
    nextPage = res.next_page ?? null;
    if (!nextPage) break;
  }
  console.log(`\n${total} events total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
