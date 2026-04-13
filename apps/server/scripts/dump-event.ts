import { managedAgentsApi, BETA_QS, type EventsResponse } from '../lib/managed-agents/client';

async function main() {
  const [sessionId, eventId] = process.argv.slice(2);
  if (!sessionId || !eventId) {
    console.error('usage: tsx scripts/dump-event.ts <sessionId> <eventId>');
    process.exit(1);
  }
  let nextPage: string | null = null;
  for (let i = 0; i < 20; i++) {
    const qs: string = nextPage
      ? `${BETA_QS}&order=asc&page=${encodeURIComponent(nextPage)}`
      : `${BETA_QS}&order=asc`;
    const res: EventsResponse = await managedAgentsApi<EventsResponse>(
      'GET',
      `/v1/sessions/${sessionId}/events${qs}`,
    );
    for (const evt of res.data) {
      if (evt.id === eventId) {
        console.log(JSON.stringify(evt, null, 2));
        return;
      }
    }
    if (!res.has_more) break;
    nextPage = res.next_page ?? null;
    if (!nextPage) break;
  }
  console.error('event not found');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
