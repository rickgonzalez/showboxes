import { useCallback, useEffect, useRef, useState } from 'react';
import { Presentation } from './react/Presentation';
import type { Presenter } from './service/presenter';
import {
  ScriptPlayer,
  StubVoicePlayer,
  WebSpeechVoicePlayer,
  GoogleCloudVoicePlayer,
  type PlayerState,
  type PresentationScript,
  type VoicePlayer,
} from './player';
import {
  fetchViewerScript,
  ViewerAuthError,
  ViewerForbiddenError,
  ViewerNotFoundError,
} from './pipeline/api';

/**
 * Viewer-mode surface — read-only Script playback, cross-origin safe.
 *
 * Zero author affordances: no PipelinePanel, no TriageModal, no flag
 * button, no sample-script loaders, no voice/wpm controls. No calls to
 * /api/triage, /api/analyze, /api/script, /api/auth/me, /api/credits,
 * or /api/notes — just the single replay fetch.
 *
 * Route: /viewer/:scriptId (?token=… for unlisted). See
 * docs/codesplain/EMBED-AND-AUTH-PLAN.md.
 */

type VoiceMode = 'off' | 'webspeech' | 'google-neural2';
// Guarded for non-Vite hosts (e.g. Next SSR) where `import.meta.env` is undefined.
const SERVER_URL = ((import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? '').replace(/\/$/, '');

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; status: 'not_found' | 'unauthorized' | 'forbidden' | 'unknown'; message?: string }
  | { kind: 'ready'; script: PresentationScript };

interface ViewerProps {
  scriptId: string;
  token: string | null;
  /**
   * Voice engine. Defaults to 'off' (silent stub) — embeds on unknown
   * pages shouldn't autoplay audio by surprise. Hosts that want voice
   * can pass their preferred engine.
   */
  voice?: VoiceMode;
  wordsPerMinute?: number;
}

export function Viewer({
  scriptId,
  token,
  voice = 'off',
  wordsPerMinute = 150,
}: ViewerProps) {
  const presenterRef = useRef<Presenter | null>(null);
  const playerRef = useRef<ScriptPlayer | null>(null);
  const [presenterReady, setPresenterReady] = useState(false);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [scenePos, setScenePos] = useState<{ index: number; total: number; id: string }>({
    index: 0,
    total: 0,
    id: '',
  });

  const handleReady = useCallback((presenter: Presenter) => {
    presenterRef.current = presenter;
    setPresenterReady(true);
  }, []);

  // Fetch once per scriptId/token.
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    fetchViewerScript(scriptId, token)
      .then((script) => {
        if (cancelled) return;
        setLoad({ kind: 'ready', script });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ViewerNotFoundError) {
          setLoad({ kind: 'error', status: 'not_found' });
        } else if (err instanceof ViewerAuthError) {
          setLoad({ kind: 'error', status: 'unauthorized' });
        } else if (err instanceof ViewerForbiddenError) {
          setLoad({ kind: 'error', status: 'forbidden' });
        } else {
          setLoad({
            kind: 'error',
            status: 'unknown',
            message: (err as Error).message,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scriptId, token]);

  // Mount the ScriptPlayer once both the presenter and the script are
  // available. Teardown on unmount.
  useEffect(() => {
    if (!presenterReady) return;
    if (load.kind !== 'ready') return;
    const p = presenterRef.current;
    if (!p) return;

    const voicePlayer: VoicePlayer =
      voice === 'webspeech'
        ? new WebSpeechVoicePlayer({ lang: 'en-US', wordsPerMinute })
        : voice === 'google-neural2'
          ? new GoogleCloudVoicePlayer({
              serverUrl: SERVER_URL,
              wordsPerMinute,
            })
          : new StubVoicePlayer();

    const script = load.script;
    const player = new ScriptPlayer(script, p, voicePlayer, {
      onSceneEnter: (scene, index) =>
        setScenePos({ index, total: script.scenes.length, id: scene.id }),
      onStateChange: setPlayerState,
    });
    playerRef.current = player;
    setScenePos({
      index: 0,
      total: script.scenes.length,
      id: script.scenes[0]?.id ?? '',
    });

    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [presenterReady, load, voice, wordsPerMinute]);

  const play = () => playerRef.current?.play();
  const pause = () => playerRef.current?.pause();

  return (
    <div className="sb-app sb-viewer">
      {load.kind === 'loading' && (
        <div className="sb-viewer-status">Loading…</div>
      )}
      {load.kind === 'error' && (
        <div className="sb-viewer-status sb-viewer-error">
          {errorCopy(load.status, load.message)}
        </div>
      )}
      {load.kind === 'ready' && (
        <header className="sb-toolbar">
          <div className="sb-toolbar-group">
            <button
              disabled={!presenterReady || playerState === 'playing'}
              onClick={play}
            >
              ▶ play
            </button>
            <button
              disabled={playerState !== 'playing'}
              onClick={pause}
            >
              ❚❚ pause
            </button>
            {scenePos.total > 0 && (
              <span className="sb-toolbar-label">
                {scenePos.index + 1}/{scenePos.total} · {playerState}
              </span>
            )}
          </div>
        </header>
      )}
      <main className="sb-stage-host">
        <Presentation onReady={handleReady} />
      </main>
    </div>
  );
}

function errorCopy(
  status: 'not_found' | 'unauthorized' | 'forbidden' | 'unknown',
  message?: string,
): string {
  switch (status) {
    case 'not_found':
      return 'Script not found.';
    case 'unauthorized':
      return 'This script is unlisted. A share link with a valid token is required.';
    case 'forbidden':
      return 'The share token is invalid or has been rotated.';
    default:
      return message ? `Error loading script: ${message}` : 'Error loading script.';
  }
}
