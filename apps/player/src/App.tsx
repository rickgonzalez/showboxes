import { useCallback, useEffect, useRef, useState } from 'react';
import { Presentation } from './react/Presentation';
import type { Presenter, TextBoxHandle } from './service/presenter';
import type { TemplateHandle } from './templates';
import { listTemplates } from './templates';
import {
  ScriptPlayer,
  StubVoicePlayer,
  WebSpeechVoicePlayer,
  sampleScripts,
  type PlayerState,
  type PresentationScript,
  type VoicePlayer,
} from './player';
import { PipelinePanel } from './pipeline/PipelinePanel';
import { postNote } from './pipeline/api';

/**
 * Demo host for the showboxes service layer. This page is the human-facing
 * exerciser — the real consumer will be an agent calling the same
 * presenter methods over a tool interface.
 */

export function App() {
  const presenterRef = useRef<Presenter | null>(null);
  const lastBoxRef = useRef<TextBoxHandle | null>(null);
  const lastTemplateRef = useRef<TemplateHandle | null>(null);
  const playerRef = useRef<ScriptPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [scenePos, setScenePos] = useState<{ index: number; total: number; id: string }>({
    index: 0,
    total: 0,
    id: '',
  });
  const [loadedScript, setLoadedScript] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    () => listTemplates().find((t) => t.demo)?.id ?? '',
  );
  const [audioOn, setAudioOn] = useState(false);
  const [wpm, setWpm] = useState(150);
  // Context needed when the user flags a scene — populated whenever a
  // script loads. Sample scripts have null ids; pipeline scripts carry both.
  const currentScriptRef = useRef<PresentationScript | null>(null);
  const currentScriptIdRef = useRef<string | null>(null);
  const currentAnalysisIdRef = useRef<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagText, setFlagText] = useState('');
  const [flagSaving, setFlagSaving] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagSaved, setFlagSaved] = useState<string | null>(null);

  const handleReady = useCallback((presenter: Presenter) => {
    presenterRef.current = presenter;
    setReady(true);
  }, []);

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      playerRef.current = null;
    };
  }, []);

  const teardownPlayer = () => {
    playerRef.current?.stop();
    playerRef.current = null;
    setPlayerState('idle');
  };

  const loadScriptObject = useCallback(
    (
      script: PresentationScript,
      label: string,
      meta?: { scriptId?: string | null; analysisId?: string | null },
    ) => {
      const p = presenterRef.current;
      if (!p) return;
      teardownPlayer();
      clearAll();

      const voice: VoicePlayer = audioOn
        ? new WebSpeechVoicePlayer({ lang: 'en-US', wordsPerMinute: wpm })
        : new StubVoicePlayer();
      const player = new ScriptPlayer(script, p, voice, {
        onSceneEnter: (scene, index) =>
          setScenePos({ index, total: script.scenes.length, id: scene.id }),
        onStateChange: setPlayerState,
      });
      playerRef.current = player;
      currentScriptRef.current = script;
      currentScriptIdRef.current = meta?.scriptId ?? null;
      currentAnalysisIdRef.current = meta?.analysisId ?? null;
      setLoadedScript(label);
      setScenePos({ index: 0, total: script.scenes.length, id: script.scenes[0]?.id ?? '' });
    },
    [audioOn, wpm],
  );

  const loadScript = (key: keyof typeof sampleScripts) => {
    loadScriptObject(sampleScripts[key], key);
  };

  const openFlag = () => {
    if (!loadedScript) return;
    playerRef.current?.pause();
    setFlagText('');
    setFlagError(null);
    setFlagSaved(null);
    setFlagOpen(true);
  };

  const submitFlag = async () => {
    const script = currentScriptRef.current;
    if (!script) return;
    const text = flagText.trim();
    if (!text) {
      setFlagError('note is required');
      return;
    }
    const scene = script.scenes[scenePos.index];
    if (!scene) {
      setFlagError('no active scene');
      return;
    }
    setFlagSaving(true);
    setFlagError(null);
    try {
      const saved = await postNote({
        scriptId: currentScriptIdRef.current,
        scriptLabel: loadedScript,
        analysisId: currentAnalysisIdRef.current,
        repoUrl: script.meta?.repoUrl ?? null,
        sceneIndex: scenePos.index,
        sceneId: scene.id,
        sceneTemplate: scene.primitive?.template ?? 'unknown',
        note: text,
      });
      setFlagSaved(saved.id);
      setFlagOpen(false);
    } catch (e) {
      setFlagError((e as Error).message);
    } finally {
      setFlagSaving(false);
    }
  };

  const playerPlay = () => playerRef.current?.play();
  const playerPause = () => playerRef.current?.pause();
  const playerNext = () => playerRef.current?.next();
  const playerPrev = () => playerRef.current?.prev();
  const playerStop = () => {
    playerRef.current?.stop();
    setLoadedScript(null);
  };

  const clearAll = () => {
    lastTemplateRef.current?.dismiss();
    lastBoxRef.current?.dismiss();
    lastBoxRef.current = null;
    lastTemplateRef.current = null;
    presenterRef.current?.clear();
  };

  const runFx = (name: string, params: Record<string, unknown> = {}) => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastBoxRef.current = p.showTextBox({
      text: labelFor(name),
      style: {
        size: 84,
        weight: '800',
        color: '#ffffff',
        bgColor: 'rgba(30,41,59,.85)',
        borderRadius: 20,
        shadow: { color: 'rgba(0,0,0,.6)', blur: 24, offsetX: 0, offsetY: 6 },
        padding: 36,
      },
      fx: [{ name, ...params }],
    });
  };

  const runDemo = (templateId: string) => {
    const p = presenterRef.current;
    if (!p) return;
    const tpl = listTemplates().find((t) => t.id === templateId);
    if (!tpl?.demo) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: tpl.id,
      content: tpl.demo.content,
    });
    const after = tpl.demo.emphasizeAfter;
    if (after) {
      setTimeout(() => lastTemplateRef.current?.emphasize?.(after.target), after.delayMs);
    }
  };


  return (
    <div className="sb-app">
      <header className="sb-toolbar">
        <h1>showboxes</h1>
        <div className="sb-toolbar-group">
          <span className="sb-toolbar-label">Effects</span>
          <button disabled={!ready} onClick={() => runFx('zoom', { duration: 600, to: 1 })}>zoom</button>
          <button disabled={!ready} onClick={() => runFx('grow', { duration: 800, to: 1.35 })}>grow</button>
          <button disabled={!ready} onClick={() => runFx('glow', { duration: 1400, strength: 40 })}>glow</button>
          <button disabled={!ready} onClick={() => runFx('slam', { duration: 520 })}>slam</button>
          <button disabled={!ready} onClick={() => runFx('shake', { duration: 500, intensity: 14 })}>shake</button>
        </div>
        <div className="sb-toolbar-group">
          <span className="sb-toolbar-label">Templates</span>
          <select
            className="sb-template-select"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            disabled={!ready}
          >
            {listTemplates()
              .filter((t) => t.demo)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.demo!.label}
                </option>
              ))}
          </select>
          <button disabled={!ready} onClick={() => runDemo(selectedTemplate)}>
            run
          </button>
        </div>
        <div className="sb-toolbar-group">
          <span className="sb-toolbar-label">Script</span>
          <button
            disabled={!ready}
            onClick={() => setAudioOn((v) => !v)}
            title="Toggle between silent StubVoicePlayer and browser SpeechSynthesis. Takes effect on next load."
          >
            🔊 audio: {audioOn ? 'on' : 'off'}
          </button>
          <label className="sb-toolbar-label" title="Lower wpm = scenes hold longer to let slower voices finish.">
            wpm
            <input
              type="number"
              min={100}
              max={260}
              step={5}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              style={{ width: 64, marginLeft: 6 }}
            />
          </label>
          <button disabled={!ready} onClick={() => loadScript('quick')}>
            load: quick
          </button>
          <button disabled={!ready} onClick={() => loadScript('mixed')}>
            load: mixed
          </button>
          <button disabled={!ready} onClick={() => loadScript('beatHeavy')}>
            load: beat-heavy
          </button>
          <button disabled={!loadedScript || playerState === 'playing'} onClick={playerPlay}>
            ▶ play
          </button>
          <button disabled={playerState !== 'playing'} onClick={playerPause}>
            ❚❚ pause
          </button>
          <button disabled={!loadedScript} onClick={playerPrev}>
            ◀ prev
          </button>
          <button disabled={!loadedScript} onClick={playerNext}>
            next ▶
          </button>
          <button disabled={!loadedScript} onClick={playerStop}>
            stop
          </button>
          <button
            disabled={!loadedScript}
            onClick={openFlag}
            title="Pause and capture a note about the current scene."
          >
            🚩 flag
          </button>
          {flagSaved && (
            <span className="sb-toolbar-label" style={{ color: '#6ee7b7' }}>
              note saved
            </span>
          )}
          {loadedScript && (
            <span className="sb-toolbar-label">
              [{loadedScript}] {scenePos.index + 1}/{scenePos.total} · {scenePos.id} ·{' '}
              {playerState}
            </span>
          )}
        </div>
        <div className="sb-toolbar-group">
          <button disabled={!ready} onClick={clearAll}>clear</button>
        </div>
      </header>
      <PipelinePanel
        canPlay={ready}
        onPlayScript={(s, meta) => loadScriptObject(s, 'pipeline', meta)}
      />
      <main className="sb-stage-host">
        <Presentation onReady={handleReady} />
      </main>
      {flagOpen && (
        <div className="sb-flag-backdrop" onClick={() => !flagSaving && setFlagOpen(false)}>
          <div className="sb-flag-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sb-flag-title">🚩 Flag this scene</div>
            <div className="sb-flag-context">
              <div>
                <span className="sb-flag-key">script:</span> {loadedScript ?? '—'}
              </div>
              <div>
                <span className="sb-flag-key">scene:</span> {scenePos.index + 1}/
                {scenePos.total} · {scenePos.id}
              </div>
              <div>
                <span className="sb-flag-key">template:</span>{' '}
                {currentScriptRef.current?.scenes[scenePos.index]?.primitive?.template ??
                  'unknown'}
              </div>
              {currentScriptIdRef.current && (
                <div>
                  <span className="sb-flag-key">scriptId:</span>{' '}
                  {currentScriptIdRef.current}
                </div>
              )}
              {currentAnalysisIdRef.current && (
                <div>
                  <span className="sb-flag-key">analysisId:</span>{' '}
                  {currentAnalysisIdRef.current}
                </div>
              )}
            </div>
            <textarea
              className="sb-flag-textarea"
              placeholder="What's wrong? (e.g. 'word too small', 'nothing rendered', 'text cut off')"
              autoFocus
              value={flagText}
              onChange={(e) => setFlagText(e.target.value)}
              rows={5}
            />
            {flagError && <div className="sb-flag-error">{flagError}</div>}
            <div className="sb-flag-actions">
              <button
                disabled={flagSaving}
                onClick={() => setFlagOpen(false)}
              >
                cancel
              </button>
              <button
                disabled={flagSaving || !flagText.trim()}
                onClick={submitFlag}
              >
                {flagSaving ? 'saving…' : 'save note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function labelFor(name: string): string {
  return name.toUpperCase();
}
