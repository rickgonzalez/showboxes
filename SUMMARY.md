# showboxes — scaffold summary

A quick inventory of what lives on the `claude/canvas-service-components-nPI9d`
branch. For run/deploy details see [README.md](./README.md).

## Stack decisions

| Concern        | Choice                              | Why                                                    |
| -------------- | ----------------------------------- | ------------------------------------------------------ |
| Build          | Vite + React + TypeScript           | Familiar to React/Vercel users, fast HMR, static build |
| Renderer       | Vanilla Canvas 2D (no WebGL)        | A few active boxes — WebGL is unused power             |
| Tweening       | anime.js (MIT)                      | Small, commercially clean, no license worries          |
| Code highlight | Prism.js                            | Tiny, unopinionated                                    |
| 3D (future)    | Three.js in a sibling `<canvas>`    | Clean separation; seam stub already in place           |
| Text layout    | **Hybrid** DOM + canvas             | DOM for body/code, canvas for effect boxes             |

Bundle: **~70 KB gzipped** including React, anime.js, Prism, and all
source.

## Layers

```
 agent tool call
       │
       ▼
 ┌──────────────┐
 │  Presenter   │  service facade — the only thing agents talk to
 │  (service)   │
 └──────┬───────┘
        │
        ├── showTextBox(...)      ── canvas effect boxes
        ├── present(template)     ── structured layouts
        └── clear() / listFx() / listTemplates()
        │
        ▼
 ┌─────────────────────────────────────┐
 │  Canvas 2D stage   +   DOM root     │
 │  (TextBox, fx)         (templates)  │
 └─────────────────────────────────────┘
```

## File layout

```
src/
├── core/
│   ├── Stage.ts         canvas ownership, DPR, render loop
│   ├── TextBox.ts       blit-cached text with animated transforms
│   ├── fx.ts            extensible effect registry
│   ├── Stage3D.ts       stub for future Three.js layer
│   └── types.ts         TextStyle, EffectSpec, TextBoxOptions
├── service/
│   └── presenter.ts     Presenter facade (positional + object forms)
├── templates/
│   ├── registry.ts      Template / TemplateHandle interfaces
│   ├── title-bullets.ts canvas title + staggered DOM bullets
│   ├── code-zoom.ts     Prism-highlighted code with zoom-in + line pulse
│   └── index.ts         registers built-ins
├── react/
│   └── Presentation.tsx thin React wrapper around the vanilla Presenter
├── App.tsx              demo toolbar exercising every effect + template
├── main.tsx
└── index.css
```

## What's actually built

### Core renderer

- **`Stage`** — one canvas, DPR-aware, resize observer, RAF loop.
- **`TextBox`** — rasterizes text to an offscreen canvas **once**, then
  `drawImage`s it every frame. That's the blitting. Animated props
  (`scale`, `rotation`, `alpha`, `glow`, `offsetX/Y`) apply at draw time
  and never invalidate the cache. The cache rebuilds only when text or
  style change.
- **`fx` registry** with six built-ins:
  `zoom`, `grow`, `glow`, `slam`, `shake`, `fadeOut`. Each effect is a
  small function that mutates the TextBox's animated properties via an
  `anime()` call. Add more with `registerFx(name, fn)`.

### Service facade (Presenter)

- `showTextBox(opts)` — **object form**, agent-friendly JSON.
- `showTextBox(text, style, name, ...args)` — **positional form**,
  human-friendly. Both resolve to the same underlying call.
- `present({ template, content })` — run a template.
- `clear()` — wipe both canvas and DOM layers.
- `listEffects()` / `listTemplates()` — discovery for agent tools.

### Templates

- **`title-bullets`** — big canvas title with a slam entrance + DOM
  bullet list that staggers in. `emphasize(index)` highlights a bullet.
- **`code-zoom`** — Prism-highlighted code in the DOM layer that zooms
  in from small via CSS transform. Each line is wrapped in a span, so
  `emphasize(lineNo)` can pulse a specific line. Accepts
  `highlight: [line, ...]` to pre-highlight lines on mount.

### Demo host

`src/App.tsx` mounts the `<Presentation>` wrapper and wires toolbar
buttons to every effect and template so you can see/feel them in the
browser.

## Not yet built (clearly marked seams)

- `showShape2D` — 2D shape primitives (rect, circle, line, arrow).
- `Stage3D` — currently a stub; will wrap Three.js in a sibling canvas.
- Word-level emphasis effect (split a long string into per-word boxes).
- More templates: `big-quote`, `compare-two`, `stat-callout`,
  `shape-explainer`.

## Extensibility cheatsheet

```ts
// Add a new effect — instantly available everywhere
import { registerFx } from './core/fx';
registerFx('typewriter', (target, { duration = 1200 }) => { /* ... */ });

// Add a new template — register it in src/templates/index.ts
import { registerTemplate } from './templates/registry';
registerTemplate({
  id: 'big-quote',
  description: 'Centered pull-quote with attribution',
  render(presenter, content) { /* ... */ return { dismiss() {} }; },
});
```
