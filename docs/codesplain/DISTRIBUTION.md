# Codesplain — Distribution Direction

The Script Player and templates are the entire presentation runtime. They take a `PresentationScript` JSON and produce an animated, narrated experience. Because they're small — a Vite bundle, client-side TypeScript, canvas + DOM + Three.js with no server dependencies at runtime — we have distribution options most SaaS products don't.

## Four distribution modes

### 1. Embeddable widget

Bundle the Player as a single JS file (Vite library mode output) and let users drop a `<script>` tag on any page plus a `<div>` target. Feed it a script JSON URL and it plays.

This turns every generated presentation into something that can live on a blog post, a company docs page, a GitHub README (via an iframe wrapper), a Notion page. **Distribution becomes viral — each presentation is an ad for the service.**

### 2. Static file export

Because a `PresentationScript` is just JSON + pre-generated voice audio files, we can export a "presentation bundle" — a zip with the `script.json`, audio clips, and a standalone HTML file that includes the Player.

Users can host it anywhere, email it, archive it, put it on their own S3. **They own their content, not us.** That's a huge trust signal, especially for enterprise.

### 3. Offline / self-hosted player

Companies with private repos and security concerns can run the Player inside their own infrastructure — the analysis happens on our servers (or theirs), but the playback artifact is portable.

Think of this like how Mermaid diagrams render anywhere: **the renderer is ubiquitous, the source is portable.**

### 4. Video export

With a headless browser (Puppeteer/Playwright) running the Player, we can record any presentation as an MP4. This unlocks LinkedIn, YouTube, Loom-style shares, embedded marketing material, conference talks.

The same script JSON that plays interactively can become a shareable video. **No new creative work needed — it's a rendering mode.**

---

## What this means for the business model

We're not just selling "AI generates a presentation." We're selling **a format** — a portable, remixable, ownable artifact.

Usage-based pricing over AI costs (the Credits model in [CREDITS.md](./CREDITS.md)) makes sense for *generation*. On top of that we can layer:

- **Hosted playback with analytics** — who watched, how far, where they dropped off.
- **Team workspaces** — version history, shared libraries of presentations.
- **Custom branding / templates** — enterprise persona and visual identity.
- **Video export** — a paid tier above the free interactive bundle.

The portability makes the free/individual tier **genuinely useful** (export and go), while the paid tier adds the **ongoing value** (hosting, analytics, team features, branding).

---

## Implications for positioning

A few things fall out of this that will shape the positioning doc and landing page copy:

1. **"Your walkthrough, yours."** Lean into ownership and portability as a differentiator vs. tools that lock content behind a viewer login.
2. **"Embed anywhere."** The widget story is concrete, demo-able, and rare — most AI content tools don't ship a renderer, just a generator.
3. **"One source, many surfaces."** Interactive, static bundle, embedded iframe, MP4 — all from the same `PresentationScript`. That's the tagline material.
4. **Freemium has a real free.** Export-and-go isn't a crippled demo; it's the product. The paid upgrade is the service around it.

The Credits model and the distribution modes are complementary: Credits price the AI work cleanly (measurable, bounded), and the distribution surface prices the ongoing value (recurring, sticky). They shouldn't be conflated in the pricing page.
