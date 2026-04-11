import { useCallback, useRef, useState } from 'react';
import { Presentation } from './react/Presentation';
import type { Presenter, TextBoxHandle } from './service/presenter';
import type { TemplateHandle } from './templates';

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
  const [ready, setReady] = useState(false);

  const handleReady = useCallback((presenter: Presenter) => {
    presenterRef.current = presenter;
    setReady(true);
  }, []);

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
        </div>
        <div className="sb-toolbar-group">
          <button disabled={!ready} onClick={clearAll}>clear</button>
        </div>
      </header>
      <main className="sb-stage-host">
        <Presentation onReady={handleReady} />
      </main>
    </div>
  );
}

function labelFor(name: string): string {
  return name.toUpperCase();
}
