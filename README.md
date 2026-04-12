# showboxes

Agent-driven presentation primitives for the browser. A small service layer
that exposes canvas text boxes (with composable entrance/emphasis effects),
DOM-based body text and code blocks, and a template layer that an agent can
target to deliver a live presentation.

- **Canvas layer** — attention-grabbing text boxes with blit-cached
  rendering and an extensible effect registry (`zoom`, `glow`, `grow`,
  `slam`, `shake`, `fadeOut`, ...).
- **DOM layer** — body text and syntax-highlighted code blocks that the
  audience can follow along with.
- **Template layer** — "set standards" that an agent picks based on the
  shape of its content (`title-bullets`, `code-zoom`, ...).
- **3D seam** — a stub for a future Three.js-powered shape layer.

## Stack

- Vite + React + TypeScript
- anime.js (MIT) for effect tweening
- Prism.js for syntax highlighting in the code-zoom template

No WebGL dependency. Canvas 2D is fast enough for the "a few active boxes"
use case and keeps the bundle minimal.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually <http://localhost:5173>) and click the
buttons in the toolbar to trigger each effect or template.

## Build

```bash
npm run build
```

Produces a static bundle in `dist/` that can be deployed to any static
host — Vercel, Netlify, Cloudflare Pages, S3, etc. On Vercel, importing
the repo auto-detects Vite and needs no configuration.

## Service API sketch

The `Presenter` class is the facade. It owns one canvas and one DOM root
and exposes both a positional and an object form of `showTextBox` so the
same call works for a human tinkerer or a JSON-emitting agent:

```ts
// Human positional form
presenter.showTextBox('This is some cool text', style, 'zoom', 600, 1);

// Agent object form (preferred for tool calls)
presenter.showTextBox({
  text: 'This is some cool text',
  style: { size: 72, color: '#fff' },
  fx: [
    { name: 'zoom', duration: 600, to: 1 },
    { name: 'glow', duration: 1400, strength: 32 },
  ],
});

// Templates
presenter.present({
  template: 'title-bullets',
  content: {
    title: 'Why blitting matters',
    bullets: ['Rasterize once', 'Draw many', 'Animate transforms cheaply'],
  },
});

presenter.present({
  template: 'code-zoom',
  content: {
    code: 'const x = 42;',
    language: 'javascript',
    highlight: [1],
  },
});
```

## Adding a new effect

Effects live in `src/core/fx.ts`. Each effect is a function that mutates
the target TextBox's animated properties (`scale`, `alpha`, `glow`,
`offsetX`, ...) via an `anime()` call. Register it:

```ts
import { registerFx } from './core/fx';

registerFx('typewriter', (target, { duration = 1200 }) => {
  // ...
});
```

The new name becomes available to every call site (positional, object
form, and templates) with no further wiring.

## Adding a new template

Templates live in `src/templates/`. Each template is a small module that
exports a `Template` object with a `render(presenter, content)` method
returning a `TemplateHandle`. Register it in `src/templates/index.ts`.

## Layout

```
src/
├── core/
│   ├── Stage.ts         # canvas ownership + render loop
│   ├── TextBox.ts       # blit-cached text with animated transforms
│   ├── fx.ts            # extensible effect registry
│   ├── Stage3D.ts       # stub for future Three.js layer
│   └── types.ts
├── service/
│   └── presenter.ts     # facade consumed by agent tools and the React host
├── templates/
│   ├── registry.ts
│   ├── title-bullets.ts
│   ├── code-zoom.ts
│   └── index.ts         # side-effect import registers built-ins
├── react/
│   └── Presentation.tsx # optional React wrapper around the Presenter
├── App.tsx              # demo host
├── main.tsx
└── index.css
```

## Roadmap

- Word-level emphasis effect (split a long string into per-word boxes for
  per-word animation).
- `showShape2D` / `showShape3D` service primitives.
- More templates: `big-quote`, `compare-two`, `stat-callout`, `shape-explainer`.
- Three.js-backed `Stage3D` for 3D shape explainers.
