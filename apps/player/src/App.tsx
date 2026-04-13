import { useCallback, useEffect, useRef, useState } from 'react';
import { Presentation } from './react/Presentation';
import type { Presenter, TextBoxHandle } from './service/presenter';
import type { TemplateHandle } from './templates';
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

/**
 * Demo host for the showboxes service layer. This page is the human-facing
 * exerciser — the real consumer will be an agent calling the same
 * presenter methods over a tool interface.
 */

const SAMPLE_CODE = `function showTextBox(opts) {
  const box = new TextBox(opts.text, opts.style);
  box.x = opts.x ?? stage.width / 2;
  box.y = opts.y ?? stage.height / 2;
  stage.add(box);
  for (const spec of opts.fx ?? []) {
    applyFx(box, spec);
  }
  return box;
}`;

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
  const [audioOn, setAudioOn] = useState(false);
  const [wpm, setWpm] = useState(150);

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
    (script: PresentationScript, label: string) => {
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
      setLoadedScript(label);
      setScenePos({ index: 0, total: script.scenes.length, id: script.scenes[0]?.id ?? '' });
    },
    [audioOn, wpm],
  );

  const loadScript = (key: keyof typeof sampleScripts) => {
    loadScriptObject(sampleScripts[key], key);
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

  const runTitleBullets = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'title-bullets',
      content: {
        title: 'Why blitting matters',
        bullets: [
          'Rasterize once into an offscreen canvas.',
          'drawImage the cached bitmap every frame.',
          'Animated transforms are free — no re-rasterization.',
          'The cache only rebuilds when text or style changes.',
        ],
        titleFx: [{ name: 'slam', duration: 600 }],
      },
    });
    // Emphasize bullet #2 after a beat.
    setTimeout(() => lastTemplateRef.current?.emphasize?.('1'), 1800);
  };

  const runCodeZoom = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'code-zoom',
      content: {
        code: SAMPLE_CODE,
        language: 'javascript',
        highlight: [5],
      },
    });
    // Pulse line 6 after the entrance settles.
    setTimeout(() => lastTemplateRef.current?.emphasize?.('6'), 1600);
  };

  const runPurposeBullets = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'purpose-bullets',
      content: {
        purpose: 'Handles user authentication and sessions',
        fileRef: 'src/services/auth.ts',
        supports: [
          { point: 'OAuth2 flow with Google and GitHub providers', type: 'feature' },
          { point: 'JWT tokens with 24-hour expiry', type: 'detail' },
          { point: 'No refresh token rotation — sessions die on expiry', type: 'concern' },
          { point: 'Rate limiting on login attempts (good practice)', type: 'strength' },
        ],
      },
    });
    // Emphasize the concern after a beat.
    setTimeout(() => lastTemplateRef.current?.emphasize?.('2'), 2200);
  };

  const runEmphasisWord = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'emphasis-word',
      content: {
        word: 'FRAGILE',
        subtitle: 'This codebase has no tests and 3 god functions over 500 lines each.',
        fx: [
          { name: 'slam', duration: 520 },
          { name: 'glow', duration: 1400, strength: 48, color: '#ff6b6b' },
          { name: 'shake', duration: 400, intensity: 8 },
        ],
        style: { size: 120, weight: '900', color: '#ff6b6b' },
      },
    });
  };

  const runCodeCloud = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'code-cloud',
      content: {
        items: [
          { text: 'React', weight: 1.0, category: 'framework' },
          { text: 'Express', weight: 0.9, category: 'framework' },
          { text: 'useState', weight: 0.85, category: 'pattern' },
          { text: 'prisma', weight: 0.7, category: 'orm' },
          { text: 'JWT', weight: 0.6, category: 'auth' },
          { text: 'WebSocket', weight: 0.4, category: 'transport' },
          { text: 'Redis', weight: 0.3, category: 'cache' },
          { text: 'useEffect', weight: 0.75, category: 'pattern' },
          { text: 'Postgres', weight: 0.65, category: 'orm' },
        ],
        categoryColors: {
          framework: 'palette.primary',
          pattern: 'palette.secondary',
          orm: 'palette.accent',
          auth: '#f59e0b',
          transport: '#8b5cf6',
          cache: '#ef4444',
        },
        entranceStyle: 'spiral',
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('JWT'), 2500);
  };

  const runTransformGrid = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'transform-grid',
      content: {
        title: 'How a request becomes a response',
        stages: [
          {
            label: 'Raw Request',
            display: {
              type: 'code',
              code: 'POST /api/login\n{email, password}',
              language: 'http',
            },
          },
          {
            label: 'Validated',
            display: {
              type: 'code',
              code: "{ email: 'rick@...',\n  password: '••••' }",
              language: 'json',
            },
          },
          {
            label: 'Authenticated',
            display: {
              type: 'text',
              text: '✓ Credentials match\n→ Generate JWT',
            },
          },
          {
            label: 'Response',
            display: {
              type: 'code',
              code: "200 OK\n{ token: 'eyJhbG...' }",
              language: 'http',
            },
          },
        ],
        staggerMs: 600,
        connector: 'arrow',
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('2'), 3200);
  };

  const runFlowDiagram = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'flow-diagram',
      content: {
        nodes: [
          { id: 'client', label: 'Browser', icon: '🖥', group: 'frontend' },
          { id: 'api', label: 'API Server', icon: '⚙', group: 'backend' },
          { id: 'auth', label: 'Auth Service', icon: '🛡', group: 'backend' },
          { id: 'db', label: 'PostgreSQL', icon: '💾', group: 'data' },
        ],
        edges: [
          { from: 'client', to: 'api', label: 'REST' },
          { from: 'api', to: 'auth', label: 'verify token' },
          { from: 'api', to: 'db', label: 'queries' },
        ],
        groups: [
          { id: 'frontend', label: 'Frontend', color: 'palette.primary' },
          { id: 'backend', label: 'Backend', color: 'palette.secondary' },
          { id: 'data', label: 'Data Layer', color: 'palette.accent' },
        ],
        staggerMs: 300,
        layout: 'left-to-right',
        orbit: true,
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('auth'), 3000);
  };

  const runStepJourney = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'step-journey',
      content: {
        title: 'From sign-up to first value',
        steps: [
          { icon: '👋', label: 'Land on site', detail: 'Hero + one CTA' },
          { icon: '📝', label: 'Sign up', detail: 'Email + password' },
          { icon: '✉️', label: 'Verify email', detail: 'Click the link' },
          { icon: '⚙️', label: 'Configure', detail: 'Pick a template' },
          { icon: '🎉', label: 'First win', detail: 'Presentation plays' },
        ],
        staggerMs: 900,
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('4'), 5200);
  };

  const runDataPipeline = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'data-pipeline',
      content: {
        title: 'Checkout math',
        input: {
          label: 'Line Items',
          display: 'table',
          data: [
            { sku: 'A1', qty: 2, price: 12 },
            { sku: 'B3', qty: 1, price: 30 },
            { sku: 'C7', qty: 3, price: 5 },
          ],
        },
        stages: [
          {
            operation: 'map → qty × price',
            label: 'Line totals',
            display: 'table',
            highlight: 'total',
            result: [
              { sku: 'A1', qty: 2, price: 12, total: 24 },
              { sku: 'B3', qty: 1, price: 30, total: 30 },
              { sku: 'C7', qty: 3, price: 5, total: 15 },
            ],
          },
          {
            operation: 'reduce → sum(total)',
            label: 'Subtotal',
            display: 'value',
            highlight: 'subtotal',
            result: { subtotal: 69 },
          },
          {
            operation: 'apply discount + tax',
            label: 'Grand total',
            display: 'breakdown',
            highlight: 'total',
            result: { subtotal: 69, discount: -5, tax: 5.76, total: 69.76 },
          },
        ],
        staggerMs: 1400,
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('2'), 4600);
  };

  const runScorecard = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'scorecard',
      content: {
        title: 'Codebase report card',
        overallGrade: 'C+',
        items: [
          { label: 'Architecture', grade: 'B+', note: 'Clean layering, clear seams.' },
          { label: 'Testing', grade: 'F', note: 'No tests at all.' },
          { label: 'Security', grade: 'C-', note: 'JWTs are not signature-verified.' },
          { label: 'Docs', grade: 'B', note: 'README + inline is solid.' },
          { label: 'Performance', grade: 'A-', note: 'Async, cached, indexed.' },
          { label: 'Dependencies', grade: 'C', note: '2 majors behind latest.' },
        ],
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('1'), 2400);
  };

  const runEntityMap = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'entity-map',
      content: {
        title: 'Data model at a glance',
        entities: [
          { id: 'user', label: 'User', icon: '👤', fields: ['id', 'email', 'name'] },
          { id: 'org', label: 'Organization', icon: '🏢', fields: ['id', 'name', 'plan'] },
          {
            id: 'project',
            label: 'Project',
            icon: '📁',
            fields: ['id', 'name', 'orgId'],
          },
          {
            id: 'presentation',
            label: 'Presentation',
            icon: '🎬',
            fields: ['id', 'projectId', 'script'],
          },
        ],
        relationships: [
          { from: 'org', to: 'user', label: 'has many', type: 'one-to-many' },
          { from: 'org', to: 'project', label: 'has many', type: 'one-to-many' },
          {
            from: 'project',
            to: 'presentation',
            label: 'has many',
            type: 'one-to-many',
          },
        ],
        staggerMs: 300,
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('project'), 2800);
  };

  const runSequenceDiagram = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'sequence-diagram',
      content: {
        title: 'Login request',
        actors: [
          { id: 'user', label: 'User', icon: '👤' },
          { id: 'api', label: 'API', icon: '⚙' },
          { id: 'auth', label: 'Auth', icon: '🛡' },
          { id: 'db', label: 'DB', icon: '💾' },
        ],
        steps: [
          { from: 'user', to: 'api', label: 'POST /login', kind: 'request' },
          { from: 'api', to: 'auth', label: 'verify(password)', kind: 'request' },
          { from: 'auth', to: 'db', label: 'SELECT user', kind: 'request' },
          { from: 'db', to: 'auth', label: 'row', kind: 'response' },
          { from: 'auth', to: 'api', label: '✓ valid', kind: 'response' },
          { from: 'api', to: 'api', label: 'sign JWT', kind: 'self' },
          { from: 'api', to: 'user', label: '200 + token', kind: 'response' },
        ],
        staggerMs: 700,
      },
    });
    setTimeout(() => lastTemplateRef.current?.emphasize?.('5'), 6200);
  };

  const runCenterStage = () => {
    const p = presenterRef.current;
    if (!p) return;
    clearAll();
    lastTemplateRef.current = p.present({
      template: 'center-stage',
      content: {
        center: { text: 'Presenter', size: 72 },
        orbiting: [
          { text: 'Stage', weight: 0.9 },
          { text: 'TextBox', weight: 0.8 },
          { text: 'fx registry', weight: 0.7 },
          { text: 'Templates', weight: 0.85 },
          { text: 'DOM Layer', weight: 0.6 },
          { text: 'Stage3D', weight: 0.3 },
        ],
        staggerMs: 200,
        orbitSpeed: 0.003,
      },
    });
    // Emphasize "Templates" orbiter after everything is in.
    setTimeout(() => lastTemplateRef.current?.emphasize?.('Templates'), 3000);
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
          <button disabled={!ready} onClick={runTitleBullets}>title + bullets</button>
          <button disabled={!ready} onClick={runCodeZoom}>code zoom</button>
          <button disabled={!ready} onClick={runPurposeBullets}>purpose bullets</button>
          <button disabled={!ready} onClick={runEmphasisWord}>emphasis word</button>
          <button disabled={!ready} onClick={runCenterStage}>center stage</button>
          <button disabled={!ready} onClick={runCodeCloud}>code cloud</button>
          <button disabled={!ready} onClick={runTransformGrid}>transform grid</button>
          <button disabled={!ready} onClick={runFlowDiagram}>flow diagram</button>
          <button disabled={!ready} onClick={runSequenceDiagram}>sequence diagram</button>
          <button disabled={!ready} onClick={runStepJourney}>step journey</button>
          <button disabled={!ready} onClick={runDataPipeline}>data pipeline</button>
          <button disabled={!ready} onClick={runScorecard}>scorecard</button>
          <button disabled={!ready} onClick={runEntityMap}>entity map</button>
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
        onPlayScript={(s) => loadScriptObject(s, 'pipeline')}
      />
      <main className="sb-stage-host">
        <Presentation onReady={handleReady} />
      </main>
    </div>
  );
}

function labelFor(name: string): string {
  return name.toUpperCase();
}
