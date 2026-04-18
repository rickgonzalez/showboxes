import type {
  AnalysisJSON,
  AnalysisMode,
  AnalysisRecord,
  AnalysisSummary,
  PresentationScript,
  ScriptRecord,
  ScriptSummary,
  TriageReport,
  UserSettings,
} from '@showboxes/shared-types';

export interface SavedScriptResult {
  script: PresentationScript;
  /** Server-assigned id of the persisted Script row (null if save failed). */
  id: string | null;
  /** Auto-derived label shown in the dropdown. */
  label: string | null;
}

/**
 * Base URL for the server API. In dev, set VITE_SERVER_URL to
 * http://localhost:3001. In prod, the server is on the same origin
 * (codesplain.io) and the base is "".
 */
// Guarded for non-Vite hosts (e.g. Next SSR) where `import.meta.env` is undefined.
const SERVER_URL = ((import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? '').replace(/\/$/, '');

function api(path: string): string {
  return `${SERVER_URL}${path}`;
}

/**
 * Kick off an analysis. The server returns immediately with the
 * analysis id; the actual agent run happens in the background (Vercel
 * `after()`). Use `pollAnalysis` to wait for completion.
 */
export interface StartAnalyzeResult {
  id: string;
  status: string;
  sessionId?: string;
  estimate?: AnalyzeEstimate;
}

export class InsufficientCreditsError extends Error {
  constructor(
    message: string,
    public readonly needed: number,
    public readonly have: number,
    public readonly estimate: AnalyzeEstimate | null,
  ) {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

export class AnalyzeAuthError extends Error {
  constructor() {
    super('not signed in');
    this.name = 'AnalyzeAuthError';
  }
}

export async function startAnalyze(
  repoUrl: string,
  mode?: AnalysisMode,
  triageReport?: TriageReport,
): Promise<StartAnalyzeResult> {
  const res = await fetch(api('/api/analyze'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoUrl, mode, triageReport }),
  });
  if (res.status === 401) {
    throw new AnalyzeAuthError();
  }
  if (res.status === 402) {
    const body = (await res.json()) as {
      needed?: number;
      have?: number;
      estimate?: AnalyzeEstimate;
    };
    throw new InsufficientCreditsError(
      'insufficient credits',
      body.needed ?? 0,
      body.have ?? 0,
      body.estimate ?? null,
    );
  }
  if (!res.ok) {
    throw new Error(`analyze failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as StartAnalyzeResult;
}

/**
 * Ask the server to interrupt a running analysis. Best-effort: the final
 * status change (`cancelled`) still arrives via the polling loop — this
 * returns as soon as the server accepts the intent.
 */
export async function cancelAnalysis(id: string): Promise<void> {
  const res = await fetch(api(`/api/analyze/${id}/cancel`), {
    method: 'POST',
    credentials: 'include',
  });
  if (res.status === 409) return; // already completed; nothing to do
  if (!res.ok) {
    throw new Error(`cancel failed: ${res.status} ${await res.text()}`);
  }
}

export interface AnalyzeEstimate {
  usd: number;
  credits: number;
  reasoning: string;
}

export interface AnalyzeEstimateResponse {
  estimate: AnalyzeEstimate;
  /** Ledger balance, or null when the caller isn't authenticated. */
  balance: number | null;
  /** Ledger balance minus held reservations. Null when unauthenticated. */
  availableBalance: number | null;
}

/**
 * Pre-flight estimate for an analysis run. Pure calculation — no side
 * effects, no auth required. Returns the user's balance when signed in
 * so the triage modal can show "~X credits · you have Y".
 */
export async function fetchAnalyzeEstimate(
  mode: AnalysisMode | undefined,
  triageReport: TriageReport,
): Promise<AnalyzeEstimateResponse> {
  const res = await fetch(api('/api/analyze/estimate'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, triageReport }),
  });
  if (!res.ok) {
    throw new Error(`estimate failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as AnalyzeEstimateResponse;
}

/**
 * Run the triage pass. Synchronous on the server (<60s typical).
 * Returns a TriageReport the UI uses to render the focus chooser.
 */
export async function runTriage(
  repoUrl: string,
  signal?: AbortSignal,
): Promise<TriageReport> {
  const res = await fetch(api('/api/triage'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
    signal,
  });
  if (res.status === 401) throw new AnalyzeAuthError();
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
  const res = await fetch(api(`/api/analyze/${id}`), {
    credentials: 'include',
  });
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
    // 'cancelling' is a transient state — the user asked to cancel, the
    // server is processing it. We keep polling until the server flips to
    // 'cancelled' (or the run finished first and flipped to 'ready').
    if (
      record.status === 'ready' ||
      record.status === 'error' ||
      record.status === 'cancelled'
    ) {
      return record;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`poll timeout after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

export interface MeResponse {
  email: string;
  balance: number;
  availableBalance: number;
  createdAt: string;
}

/** Returns the signed-in user or null when not authenticated. */
export async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch(api('/api/auth/me'), { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`me failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as MeResponse;
}

/**
 * List prior analyses, newest first. Pass a repoUrl to filter; omit
 * to list across all repos. Owner-scoped on the server — returns an
 * empty list for anonymous callers.
 */
export async function listAnalyses(
  repoUrl?: string,
): Promise<AnalysisSummary[]> {
  const qs = repoUrl ? `?repoUrl=${encodeURIComponent(repoUrl)}` : '';
  const res = await fetch(api(`/api/analyses${qs}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`list analyses failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { analyses: AnalysisSummary[] };
  return body.analyses;
}

export async function postScript(
  analysis: AnalysisJSON,
  settings: UserSettings,
  analysisId?: string,
): Promise<SavedScriptResult> {
  const res = await fetch(api('/api/script'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ analysis, settings, analysisId }),
  });
  if (res.status === 401) throw new AnalyzeAuthError();
  if (!res.ok) {
    throw new Error(`script failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as PresentationScript & {
    _id?: string | null;
    _label?: string | null;
  };
  const { _id, _label, ...rest } = body;
  return {
    script: rest as PresentationScript,
    id: _id ?? null,
    label: _label ?? null,
  };
}

/**
 * List saved scripts, newest first. Pass `analysisId` to scope to a
 * specific analysis run, or `repoUrl` to span all analyses of a repo.
 */
export async function listScripts(opts: {
  analysisId?: string;
  repoUrl?: string;
} = {}): Promise<ScriptSummary[]> {
  const params = new URLSearchParams();
  if (opts.analysisId) params.set('analysisId', opts.analysisId);
  if (opts.repoUrl) params.set('repoUrl', opts.repoUrl);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(api(`/api/scripts${qs}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`list scripts failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { scripts: ScriptSummary[] };
  return body.scripts;
}

/** Fetch the full saved Script record (includes the script `data` blob). */
export async function getScript(id: string): Promise<ScriptRecord> {
  const res = await fetch(api(`/api/scripts/${id}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`get script failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ScriptRecord;
}

/**
 * Viewer-mode fetch for a Script by id. Uses the replay endpoint so we
 * get the raw PresentationScript stripped of cost/persistence metadata.
 * Pass `token` for unlisted Scripts; omit when the caller owns the Script
 * (their session cookie covers access).
 *
 * Throws distinct errors the viewer UI can render:
 *   - ViewerNotFoundError  → 404: script doesn't exist or isn't reachable
 *   - ViewerAuthError      → 401: token required and missing
 *   - ViewerForbiddenError → 403: token provided but wrong
 */
export class ViewerNotFoundError extends Error {
  constructor() {
    super('not found');
    this.name = 'ViewerNotFoundError';
  }
}

export class ViewerAuthError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'ViewerAuthError';
  }
}

export class ViewerForbiddenError extends Error {
  constructor() {
    super('forbidden');
    this.name = 'ViewerForbiddenError';
  }
}

export async function fetchViewerScript(
  id: string,
  token: string | null,
): Promise<PresentationScript> {
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const res = await fetch(api(`/api/scripts/${id}/replay${qs}`), {
    credentials: 'include',
  });
  if (res.status === 404) throw new ViewerNotFoundError();
  if (res.status === 401) throw new ViewerAuthError();
  if (res.status === 403) throw new ViewerForbiddenError();
  if (!res.ok) {
    throw new Error(`viewer fetch failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PresentationScript;
}

export interface PostNoteInput {
  /**
   * Required — the server rejects notes without a scriptId since the
   * route is author-only and ownership is checked via the Script row.
   * Sample scripts (which have no persisted row) can't be flagged.
   */
  scriptId: string;
  scriptLabel: string | null;
  analysisId: string | null;
  repoUrl: string | null;
  sceneIndex: number;
  sceneId: string;
  sceneTemplate: string;
  note: string;
}

/** Save a reviewer flag/note against the current scene. */
export async function postNote(
  input: PostNoteInput,
): Promise<{ id: string; createdAt: string }> {
  const res = await fetch(api('/api/notes'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`note failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; createdAt: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
