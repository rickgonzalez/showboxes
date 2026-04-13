import type {
  AnalysisJSON,
  AnalysisMode,
  AnalysisRecord,
  AnalysisSummary,
  PresentationScript,
  TriageReport,
  UserSettings,
} from '@showboxes/shared-types';

/**
 * Base URL for the server API. In dev, set VITE_SERVER_URL to
 * http://localhost:3001. In prod, the server is on the same origin
 * (codesplain.io) and the base is "".
 */
const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');

function api(path: string): string {
  return `${SERVER_URL}${path}`;
}

/**
 * Kick off an analysis. The server returns immediately with the
 * analysis id; the actual agent run happens in the background (Vercel
 * `after()`). Use `pollAnalysis` to wait for completion.
 */
export async function startAnalyze(
  repoUrl: string,
  mode?: AnalysisMode,
): Promise<{ id: string; status: string }> {
  const res = await fetch(api('/api/analyze'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoUrl, mode }),
  });
  if (!res.ok) {
    throw new Error(`analyze failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; status: string };
}

/**
 * Run the triage pass. Synchronous on the server (<60s typical).
 * Returns a TriageReport the UI uses to render the focus chooser.
 */
export async function runTriage(repoUrl: string): Promise<TriageReport> {
  const res = await fetch(api('/api/triage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
  if (!res.ok) {
    throw new Error(`triage failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { sessionId: string; report: TriageReport };
  return body.report;
}

/**
 * Fetch the current state of an analysis. Returns the record with
 * status = 'running' | 'ready' | 'error'; `data` is only populated
 * when status is 'ready'.
 */
export async function getAnalysis(id: string): Promise<AnalysisRecord> {
  const res = await fetch(api(`/api/analyze/${id}`));
  if (!res.ok) {
    throw new Error(`get analysis failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as AnalysisRecord;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onTick?: (record: AnalysisRecord) => void;
  signal?: AbortSignal;
}

/**
 * Poll `/api/analyze/:id` until status leaves 'running'. Returns the
 * completed record (status = 'ready' or 'error'). Default: 3s interval,
 * 15 minute ceiling.
 */
export async function pollAnalysis(
  id: string,
  opts: PollOptions = {},
): Promise<AnalysisRecord> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const start = Date.now();

  for (;;) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const record = await getAnalysis(id);
    opts.onTick?.(record);
    if (record.status !== 'running') return record;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`poll timeout after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

/**
 * List prior analyses, newest first. Pass a repoUrl to filter; omit
 * to list across all repos.
 */
export async function listAnalyses(
  repoUrl?: string,
): Promise<AnalysisSummary[]> {
  const qs = repoUrl ? `?repoUrl=${encodeURIComponent(repoUrl)}` : '';
  const res = await fetch(api(`/api/analyses${qs}`));
  if (!res.ok) {
    throw new Error(`list analyses failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { analyses: AnalysisSummary[] };
  return body.analyses;
}

export async function postScript(
  analysis: AnalysisJSON,
  settings: UserSettings,
): Promise<PresentationScript> {
  const res = await fetch(api('/api/script'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ analysis, settings }),
  });
  if (!res.ok) {
    throw new Error(`script failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PresentationScript;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
