import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AnalysisMode,
  AnalysisRecord,
  PresentationScript,
  TriageReport,
} from '@showboxes/shared-types';
import { defaultSettings } from '@showboxes/shared-types';
import { Presentation } from '../react/Presentation';
import type { Presenter } from '../service/presenter';
import {
  GoogleCloudVoicePlayer,
  ScriptPlayer,
  StubVoicePlayer,
  type PlayerState,
  type VoicePlayer,
} from '../player';
import { DEFAULT_DESIGN_SIZE, type DesignSize } from '../designSize';

// Guarded for non-Vite hosts (e.g. Next SSR) where `import.meta.env` is undefined.
const SERVER_URL = (
  (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? ''
).replace(/\/$/, '');
import { TriageModal } from './TriageModal';
import {
  AnalyzeAuthError,
  InsufficientCreditsError,
  cancelAnalysis,
  fetchMe,
  getAnalysis,
  postScript,
  runTriage,
  startAnalyze,
  type MeResponse,
} from './api';

type FlowState =
  | { kind: 'url' }
  | { kind: 'triage'; repoUrl: string }
  | { kind: 'choices'; repoUrl: string; report: TriageReport }
  | {
      kind: 'analysis';
      repoUrl: string;
      report: TriageReport;
      mode: AnalysisMode;
      analysisId: string;
      reserved: number | null;
    }
  | {
      kind: 'script';
      repoUrl: string;
      report: TriageReport;
      analysis: AnalysisRecord;
    }
  | {
      kind: 'playing';
      repoUrl: string;
      report: TriageReport;
      analysis: AnalysisRecord;
      script: PresentationScript;
    };

const GITHUB_URL = /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/i;

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export interface GenerateFlowProps {
  /**
   * Fixed-pixel design surface the player renders into. Defaults to
   * DEFAULT_DESIGN_SIZE (1280×1280). Pass a smaller size to enlarge
   * content in the same host frame; pass a larger size to give templates
   * more room before scaling down.
   */
  designSize?: DesignSize;
}

export function GenerateFlow({ designSize = DEFAULT_DESIGN_SIZE }: GenerateFlowProps = {}) {
  const [state, setState] = useState<FlowState>({ kind: 'url' });
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triageAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Hydrate auth on mount so the URL screen can label the button correctly.
  useEffect(() => {
    fetchMe()
      .then((res) => setMe(res))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, []);

  // ---- Transitions ----

  const reset = useCallback(() => {
    triageAbortRef.current?.abort();
    pollAbortRef.current?.abort();
    triageAbortRef.current = null;
    pollAbortRef.current = null;
    setError(null);
    setState({ kind: 'url' });
  }, []);

  const startTriage = useCallback(async (repoUrl: string) => {
    const controller = new AbortController();
    triageAbortRef.current = controller;
    setError(null);
    setState({ kind: 'triage', repoUrl });
    try {
      const report = await runTriage(repoUrl, controller.signal);
      if (controller.signal.aborted) return;
      setState({ kind: 'choices', repoUrl, report });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof AnalyzeAuthError) {
        window.location.assign(`/login?next=${encodeURIComponent('/generate')}`);
        return;
      }
      setError((e as Error).message);
      setState({ kind: 'url' });
    }
  }, []);

  const confirmChoices = useCallback(
    async (mode: AnalysisMode) => {
      if (state.kind !== 'choices') return;
      setError(null);
      try {
        const res = await startAnalyze(state.repoUrl, mode, state.report);
        setState({
          kind: 'analysis',
          repoUrl: state.repoUrl,
          report: state.report,
          mode,
          analysisId: res.id,
          reserved: res.estimate?.credits ?? null,
        });
      } catch (e) {
        if (e instanceof AnalyzeAuthError) {
          window.location.assign(
            `/login?next=${encodeURIComponent('/generate')}`,
          );
          return;
        }
        if (e instanceof InsufficientCreditsError) {
          setError(
            `Not enough credits: need ${e.needed}, you have ${e.have}. Top up to continue.`,
          );
          return;
        }
        setError((e as Error).message);
      }
    },
    [state],
  );

  const analysisId = state.kind === 'analysis' ? state.analysisId : null;
  const scriptAnalysisId = state.kind === 'script' ? state.analysis.id : null;
  const scriptAnalysisData = state.kind === 'script' ? state.analysis.data : null;

  // Polling loop for the analysis stage. Runs as long as state is 'analysis'.
  useEffect(() => {
    if (!analysisId) return;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    let cancelled = false;

    async function run() {
      const backoff = 3000;
      while (!cancelled) {
        try {
          const rec = await getAnalysis(analysisId!);
          if (cancelled) return;
          if (rec.status === 'ready') {
            setState((prev) =>
              prev.kind === 'analysis'
                ? {
                    kind: 'script',
                    repoUrl: prev.repoUrl,
                    report: prev.report,
                    analysis: rec,
                  }
                : prev,
            );
            return;
          }
          if (rec.status === 'error') {
            setError(rec.error ?? 'Analysis failed.');
            setState((prev) =>
              prev.kind === 'analysis'
                ? { kind: 'choices', repoUrl: prev.repoUrl, report: prev.report }
                : prev,
            );
            return;
          }
          if (rec.status === 'cancelled') {
            setError('Cancelled. Charged only for work completed.');
            setState((prev) =>
              prev.kind === 'analysis'
                ? { kind: 'choices', repoUrl: prev.repoUrl, report: prev.report }
                : prev,
            );
            return;
          }
          await new Promise((r) => setTimeout(r, backoff));
        } catch (e) {
          if (cancelled) return;
          console.warn('[generate] poll tick failed:', (e as Error).message);
          await new Promise((r) => setTimeout(r, backoff * 2));
        }
      }
    }
    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [analysisId]);

  // Kick off script generation when entering 'script' state.
  useEffect(() => {
    if (!scriptAnalysisId) return;
    if (!scriptAnalysisData) {
      setError('Analysis finished without data — please retry.');
      setState((prev) =>
        prev.kind === 'script'
          ? { kind: 'choices', repoUrl: prev.repoUrl, report: prev.report }
          : prev,
      );
      return;
    }
    let cancelled = false;
    postScript(scriptAnalysisData, defaultSettings, scriptAnalysisId)
      .then((res) => {
        if (cancelled) return;
        setState((prev) =>
          prev.kind === 'script'
            ? {
                kind: 'playing',
                repoUrl: prev.repoUrl,
                report: prev.report,
                analysis: prev.analysis,
                script: res.script,
              }
            : prev,
        );
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AnalyzeAuthError) {
          window.location.assign(
            `/login?next=${encodeURIComponent('/generate')}`,
          );
          return;
        }
        setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [scriptAnalysisId, scriptAnalysisData]);

  // ---- Rendering ----

  return (
    <div className="sb-generate">
      <header className="sb-generate-header">
        <a className="sb-generate-brand" href="/generate">
          <img
            src="/codesplain_logo.png"
            alt="Codesplain"
            className="sb-generate-logo"
          />
          <span className="sb-generate-brand-name">codesplain</span>
        </a>
        <div className="sb-generate-header-right">
          {meLoaded && me && (
            <span
              className="sb-generate-balance"
              title={`${me.availableBalance.toLocaleString()} available credits`}
            >
              {me.availableBalance.toLocaleString()} cr
            </span>
          )}
          {meLoaded && !me && (
            <a
              className="sb-generate-signin"
              href={`/login?next=${encodeURIComponent('/generate')}`}
            >
              Sign in
            </a>
          )}
        </div>
      </header>

      <main className="sb-generate-main">
        <div className="sb-generate-flow-column">
          {state.kind === 'url' && (
            <UrlStep
              signedIn={Boolean(me)}
              authLoaded={meLoaded}
              error={error}
              onSubmit={startTriage}
            />
          )}
          {state.kind === 'triage' && (
            <RunningStep
              title="Scoping your codebase"
              hint="~30s typical"
              onCancel={() => {
                triageAbortRef.current?.abort();
                setState({ kind: 'url' });
              }}
              cancelLabel="Cancel"
            />
          )}
          {state.kind === 'choices' && (
            <TriageModal
              report={state.report}
              onConfirm={confirmChoices}
              onCancel={() => setState({ kind: 'url' })}
            />
          )}
          {state.kind === 'analysis' && (
            <AnalysisStep
              reserved={state.reserved}
              onCancel={async () => {
                try {
                  await cancelAnalysis(state.analysisId);
                } catch (e) {
                  console.warn('[generate] cancel failed:', e);
                }
                // Polling will pick up 'cancelled' and advance the UI.
              }}
            />
          )}
          {state.kind === 'script' && (
            <RunningStep
              title="Composing the script"
              hint="Almost there"
              onCancel={null}
              cancelLabel=""
            />
          )}
          {state.kind === 'playing' && (
            <PlayingStep
              script={state.script}
              designSize={designSize}
              onRerun={() =>
                setState({
                  kind: 'choices',
                  repoUrl: state.repoUrl,
                  report: state.report,
                })
              }
              onRestart={reset}
            />
          )}
        </div>
        <aside className="sb-generate-side-column" aria-label="Reading while you wait">
          <BlogPanel />
        </aside>
      </main>

      {error && state.kind === 'url' && (
        <div className="sb-generate-error-toast">{error}</div>
      )}
    </div>
  );
}

/**
 * Right-rail companion panel. Today this is a stub — a placeholder for
 * daily-blog backlinks sourced from a sibling content project. Copy is
 * intentionally light so the rail doesn't compete with the flow itself.
 *
 * TODO: wire to a real content feed (likely a static JSON at
 * /content/daily.json populated by the sibling project).
 */
function BlogPanel() {
  const items: Array<{
    title: string;
    excerpt: string;
    href: string;
    kind: 'research' | 'walkthrough';
  }> = [
    {
      title: 'How we picked `focused-brief` over `deep-dive`',
      excerpt:
        'Depth is a slider, not a mode. Notes from a week of prompt tuning against large repos.',
      href: '#',
      kind: 'research',
    },
    {
      title: 'Walkthrough: Anthropic SDK, end to end',
      excerpt:
        'Tool use, caching, and streaming — narrated scene by scene from the SDK source.',
      href: '#',
      kind: 'walkthrough',
    },
    {
      title: 'Why sequence diagrams beat flow charts for request paths',
      excerpt:
        'When a diagram crosses four services, order of operations matters more than shape.',
      href: '#',
      kind: 'research',
    },
    {
      title: 'Walkthrough: a Next.js App Router auth flow',
      excerpt:
        'Magic links, sessions, and the cookie gymnastics that tripped us up.',
      href: '#',
      kind: 'walkthrough',
    },
  ];

  return (
    <div className="sb-generate-blog">
      <div className="sb-generate-blog-eyebrow">While you wait</div>
      <h2 className="sb-generate-blog-title">Fresh reads from the lab</h2>
      <p className="sb-generate-blog-hint">
        Daily research and finished walkthroughs — pulled in from the content
        team. A good place to land while the agents are busy.
      </p>
      <ul className="sb-generate-blog-list">
        {items.map((it) => (
          <li key={it.title} className="sb-generate-blog-item">
            <a
              className="sb-generate-blog-link"
              href={it.href}
              target={it.href === '#' ? undefined : '_blank'}
              rel={it.href === '#' ? undefined : 'noreferrer'}
            >
              <span
                className={`sb-generate-blog-tag sb-generate-blog-tag-${it.kind}`}
              >
                {it.kind === 'research' ? 'Research' : 'Walkthrough'}
              </span>
              <span className="sb-generate-blog-item-title">{it.title}</span>
              <span className="sb-generate-blog-item-excerpt">{it.excerpt}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------- Sub-components -------------------------

function UrlStep({
  signedIn,
  authLoaded,
  error,
  onSubmit,
}: {
  signedIn: boolean;
  authLoaded: boolean;
  error: string | null;
  onSubmit: (repoUrl: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = GITHUB_URL.test(url);
  const canSubmit = valid && authLoaded;

  const handle = () => {
    setTouched(true);
    if (!valid) return;
    if (!signedIn) {
      window.location.assign(
        `/login?next=${encodeURIComponent('/generate')}`,
      );
      return;
    }
    onSubmit(url.trim());
  };

  return (
    <section className="sb-generate-card sb-generate-url">
      <div className="sb-generate-card-eyebrow">Step 1</div>
      <h1 className="sb-generate-card-title">Paste a GitHub repo</h1>
      <p className="sb-generate-card-hint">
        We&rsquo;ll scope it, then let you pick how deep to go.
      </p>
      <form
        className="sb-generate-url-form"
        onSubmit={(e) => {
          e.preventDefault();
          handle();
        }}
      >
        <input
          className="sb-generate-input"
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setTouched(false);
          }}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          className="sb-generate-primary"
          type="submit"
          disabled={!canSubmit}
        >
          {signedIn ? 'Generate a walkthrough' : 'Sign in to generate'}
        </button>
      </form>
      {touched && !valid && (
        <div className="sb-generate-inline-error">
          That doesn&rsquo;t look like a GitHub URL.
        </div>
      )}
      {error && <div className="sb-generate-inline-error">{error}</div>}
    </section>
  );
}

function RunningStep({
  title,
  hint,
  onCancel,
  cancelLabel,
}: {
  title: string;
  hint: string;
  onCancel: (() => void) | null;
  cancelLabel: string;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const h = setInterval(() => setElapsedMs(Date.now() - start), 500);
    return () => clearInterval(h);
  }, []);
  return (
    <section className="sb-generate-card sb-generate-running">
      <Spinner />
      <h2 className="sb-generate-running-title">{title}</h2>
      <div className="sb-generate-running-meta">
        <span className="sb-generate-elapsed">{formatElapsed(elapsedMs)}</span>
        <span className="sb-generate-hint-dot">·</span>
        <span className="sb-generate-hint">{hint}</span>
      </div>
      {onCancel && (
        <button className="sb-generate-ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
    </section>
  );
}

function AnalysisStep({
  reserved,
  onCancel,
}: {
  reserved: number | null;
  onCancel: () => Promise<void>;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    const start = Date.now();
    const h = setInterval(() => setElapsedMs(Date.now() - start), 500);
    return () => clearInterval(h);
  }, []);

  return (
    <section className="sb-generate-card sb-generate-running">
      <Spinner big />
      <h2 className="sb-generate-running-title">Building the analysis</h2>
      <div className="sb-generate-running-meta">
        <span className="sb-generate-elapsed">{formatElapsed(elapsedMs)}</span>
        <span className="sb-generate-hint-dot">·</span>
        <span className="sb-generate-hint">~3&ndash;5 min typical</span>
      </div>
      {reserved != null && (
        <div className="sb-generate-reserved">
          ~{reserved.toLocaleString()} credits held during this run
        </div>
      )}
      <button
        className="sb-generate-ghost"
        onClick={() => setConfirmOpen(true)}
        disabled={cancelling}
      >
        {cancelling ? 'Cancelling\u2026' : 'Cancel'}
      </button>

      {confirmOpen && (
        <div className="sb-generate-confirm-backdrop">
          <div
            className="sb-generate-confirm"
            role="dialog"
            aria-modal="true"
          >
            <div className="sb-generate-confirm-title">
              Cancel this analysis?
            </div>
            <p className="sb-generate-confirm-body">
              Work already completed will be billed, but we&rsquo;ll stop any
              further charges. You&rsquo;ll see the final amount on your
              credits page.
            </p>
            <div className="sb-generate-confirm-actions">
              <button
                className="sb-generate-ghost"
                onClick={() => setConfirmOpen(false)}
              >
                Keep running
              </button>
              <button
                className="sb-generate-danger"
                disabled={cancelling}
                onClick={async () => {
                  setCancelling(true);
                  await onCancel();
                  setConfirmOpen(false);
                }}
              >
                {cancelling ? 'Cancelling\u2026' : 'Cancel analysis'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PlayingStep({
  script,
  designSize,
  onRerun,
  onRestart,
}: {
  script: PresentationScript;
  designSize: DesignSize;
  onRerun: () => void;
  onRestart: () => void;
}) {
  const presenterRef = useRef<Presenter | null>(null);
  const playerRef = useRef<ScriptPlayer | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [scenePos, setScenePos] = useState({ index: 0, total: 0 });
  const [scale, setScale] = useState(1);
  // Voice defaults to on (Google Neural2). Browsers block autoplay with
  // audio unless the user gestures — so we arm paused and wait for the
  // Play button instead of autoplaying.
  const [useVoice, setUseVoice] = useState(true);

  // Scale the fixed-size design surface to fit the stage box at any
  // viewport. Watches the box with a ResizeObserver; the chosen scale
  // is the smaller of width/design.width and height/design.height so the
  // surface always fits without overflowing. Re-runs when designSize
  // changes so prop tweaks update live.
  useLayoutEffect(() => {
    const el = stageBoxRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setScale(Math.min(width / designSize.width, height / designSize.height));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designSize.width, designSize.height]);

  const armPlayer = useCallback(
    (p: Presenter) => {
      playerRef.current?.stop();
      const voice: VoicePlayer = useVoice
        ? new GoogleCloudVoicePlayer({ serverUrl: SERVER_URL, wordsPerMinute: 150 })
        : new StubVoicePlayer();
      const player = new ScriptPlayer(script, p, voice, {
        onSceneEnter: (_s, i) =>
          setScenePos({ index: i, total: script.scenes.length }),
        onStateChange: setPlayerState,
      });
      playerRef.current = player;
      setScenePos({ index: 0, total: script.scenes.length });
    },
    [script, useVoice],
  );

  const handleReady = useCallback(
    (p: Presenter) => {
      presenterRef.current = p;
      armPlayer(p);
    },
    [armPlayer],
  );

  // Re-arm when voice toggle flips (Presentation stays mounted).
  useEffect(() => {
    const p = presenterRef.current;
    if (!p) return;
    armPlayer(p);
    // armPlayer captures useVoice; rerun when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useVoice]);

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      playerRef.current = null;
    };
  }, []);

  const isPlaying = playerState === 'playing';

  return (
    <section className="sb-generate-player">
      <div
        className="sb-generate-player-stage"
        ref={stageBoxRef}
        style={{ aspectRatio: `${designSize.width} / ${designSize.height}` }}
      >
        {/* Fixed-size design surface. Templates are authored in absolute
            pixels against `designSize`; this wrapper scales the whole thing
            with a CSS transform so it fits without overflow. Same pattern
            as HeroPlayer on the landing page. */}
        <div
          className="sb-generate-player-surface"
          style={{
            width: designSize.width,
            height: designSize.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <Presentation onReady={handleReady} />
        </div>
      </div>
      <div className="sb-generate-player-controls">
        <div className="sb-generate-player-info">
          Scene {scenePos.index + 1} / {scenePos.total} &middot; {playerState}
        </div>
        <div className="sb-generate-player-buttons">
          <button
            className="sb-generate-primary sb-generate-play-btn"
            onClick={() =>
              isPlaying ? playerRef.current?.pause() : playerRef.current?.play()
            }
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            className="sb-generate-ghost"
            onClick={() => playerRef.current?.prev()}
          >
            Prev
          </button>
          <button
            className="sb-generate-ghost"
            onClick={() => playerRef.current?.next()}
          >
            Next
          </button>
          <label className="sb-generate-voice-toggle">
            <input
              type="checkbox"
              checked={useVoice}
              onChange={(e) => setUseVoice(e.target.checked)}
            />
            Voice
          </label>
        </div>
        <div className="sb-generate-player-loop">
          <button className="sb-generate-primary" onClick={onRerun}>
            Try another angle
          </button>
          <button className="sb-generate-ghost" onClick={onRestart}>
            Pick a new repo
          </button>
        </div>
      </div>
    </section>
  );
}

function Spinner({ big }: { big?: boolean }) {
  return (
    <div
      className={big ? 'sb-generate-spinner sb-generate-spinner-lg' : 'sb-generate-spinner'}
      aria-hidden
    />
  );
}
