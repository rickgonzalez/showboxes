# Showboxes — System Architecture

## The Pitch in One Sentence

Point an agent at a GitHub repo, get back an animated visual presentation that explains the codebase to humans who may or may not write code.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                         │
│                                                               │
│  ┌─────────────┐  ┌──────────────────────────────────────┐   │
│  │ GitHub URL   │  │  Presentation Settings               │   │
│  │ + OAuth      │  │                                      │   │
│  └──────┬──────┘  │  Audience:    [■■■■■□□□□□] technical  │   │
│         │         │  Detail:      [■■■■■■□□□□] deep       │   │
│         │         │  Pace:        [■■■□□□□□□□] slow        │   │
│         │         │  Voice:       ElevenLabs / Kokoro      │   │
│         │         │  Template:    Corporate / Character /   │   │
│         │         │               Friendly / Stern          │   │
│         │         └──────────────────────┬───────────────┘   │
│         │                                │                    │
└─────────┼────────────────────────────────┼────────────────────┘
          │                                │
          ▼                                │
┌──────────────────┐                       │
│   AGENT 1        │                       │
│   Code Analyst   │                       │
│                  │                       │
│   Clone repo     │                       │
│   Map structure  │                       │
│   Assess quality │                       │
│   Explain in     │                       │
│   plain English  │                       │
│                  │                       │
│   Output:        │                       │
│   Analysis JSON  │                       │
│   (structured)   ├───────┐               │
└──────────────────┘       │               │
                           ▼               ▼
                  ┌──────────────────────────────┐
                  │   AGENT 2                     │
                  │   Producer / Director         │
                  │                               │
                  │   Inputs:                     │
                  │   - Analysis JSON (Agent 1)   │
                  │   - User settings (sliders)   │
                  │   - Template persona          │
                  │   - Voice config              │
                  │                               │
                  │   Job:                        │
                  │   Write a presentation script │
                  │   with scene-by-scene visual  │
                  │   notations                   │
                  │                               │
                  │   Output:                     │
                  │   PresentationScript JSON     │
                  └──────────────┬───────────────┘
                                │
                                ▼
                  ┌──────────────────────────────┐
                  │   SCRIPT PLAYER              │
                  │   (Client-side runtime)       │
                  │                               │
                  │   Reads the script scene by   │
                  │   scene. For each scene:      │
                  │   - Selects visual primitive  │
                  │   - Passes content + config   │
                  │   - Manages timing/transitions│
                  │   - Triggers voice audio      │
                  │                               │
                  │   Controls:                   │
                  │   Play / Pause / Seek / Speed │
                  └──────────────┬───────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                      │
          ▼                     ▼                      ▼
┌───────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  CANVAS LAYER │  │    DOM LAYER     │  │   3D LAYER       │
│  (Stage)      │  │                  │  │   (Stage3D)      │
│               │  │  Code blocks     │  │                  │
│  TextBox +    │  │  Bullet lists    │  │  Flow diagrams   │
│  Effects      │  │  Code cloud      │  │  Dependency      │
│  Emphasis     │  │  Transform grid  │  │  graphs          │
│  Center Stage │  │                  │  │                  │
└───────────────┘  └──────────────────┘  └──────────────────┘
          │                     │                      │
          └─────────────────────┼──────────────────────┘
                                │
                          ┌─────┴──────┐
                          │   AUDIO    │
                          │            │
                          │ ElevenLabs │
                          │ Kokoro     │
                          │ (TTS)      │
                          └────────────┘
```

---

## The Two Agents

### Agent 1 — Code Analyst

Already defined (see `extract-gnome-kit/agents/defaults/code-analysis.defaults.ts`).

**Input:** A GitHub repo URL (from the user) + optional focus areas.

**Process:** Clones the repo. Uses built-in file tools (bash, glob, grep, read) to explore. Produces a structured analysis.

**Output:** `AnalysisJSON` — the structured schema defined in `platform-tools/providers/code-analysis.ts`. Five sections: quickFacts, architecture, codeQuality, plainEnglish, health.

**Runtime:** Anthropic Managed Agents beta. The built-in `agent_toolset_20260401` gives it bash + file tools. The `submit_code_analysis` custom tool delivers structured output.

**Key constraint:** This agent has NO knowledge of the presentation layer. It doesn't know about showboxes, templates, or visual primitives. It produces pure analysis. This separation is what makes the system composable — the same analysis could feed a slide deck, a PDF report, or a live presentation.

### Agent 2 — Producer / Director

**Input:** Three things merged into its context:
1. The `AnalysisJSON` from Agent 1 (the "material")
2. The user's presentation settings (audience level, detail, pace, template, voice)
3. The visual primitive catalog (what tools are available and their contracts)

**Process:** Reads the analysis. Considers the audience and template persona. Writes a `PresentationScript` — an ordered sequence of scenes, each specifying which visual primitive to use, what content to show, what narration to speak, and how to transition.

**Output:** `PresentationScript` JSON — the contract between the agent and the showboxes runtime.

**The Director's creative constraints come from:**
- The **template persona** (corporate = clean transitions, data-forward; character = playful, analogy-heavy; friendly = warm, story-driven; stern = no-nonsense, findings-first)
- The **audience slider** (technical → more code, architecture detail; non-technical → more analogies, user journeys, simplified diagrams)
- The **detail slider** (deep → more scenes, more coverage; summary → fewer scenes, key highlights only)
- The **pace slider** (slow → longer narration, pauses, more emphasis effects; fast → tight narration, quick transitions)

**Runtime:** Could be Managed Agents or a direct API call. The Producer doesn't need file tools — it's a pure reasoning + structured output task. A single Messages API call with the analysis JSON in context and the script schema as a tool might be sufficient. Managed Agents adds the plan/approve gate if you want human review of the script before rendering.

---

## The Presentation Script Format

This is the contract between Agent 2 (Producer) and the client-side Script Player. The Producer writes it; the Player reads it.

```typescript
interface PresentationScript {
  /** Metadata about the presentation */
  meta: {
    title: string;
    repoUrl: string;
    generatedAt: string;
    /** Template persona used (affects visual defaults) */
    persona: "corporate" | "character" | "friendly" | "stern";
    /** Estimated total duration in seconds */
    estimatedDuration: number;
  };

  /** Global visual defaults for this presentation */
  defaults: {
    /** Base color palette — the Player maps these to CSS/canvas colors */
    palette: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      text: string;
      code: string;
    };
    /** Default transition between scenes */
    transition: TransitionSpec;
    /** Voice configuration */
    voice: {
      provider: "elevenlabs" | "kokoro";
      voiceId: string;
      speed: number;
    };
  };

  /** Ordered sequence of scenes */
  scenes: Scene[];
}

interface Scene {
  /** Unique ID for seeking/bookmarking */
  id: string;
  /** Which section of the analysis this scene presents */
  section: "quickFacts" | "architecture" | "codeQuality" | "plainEnglish" | "health";
  /** The visual primitive to use */
  primitive: PrimitiveSpec;
  /** Narration text (fed to TTS) */
  narration: string;
  /** How long this scene holds (seconds). Player uses this + narration
      length to determine actual duration. */
  holdSeconds: number;
  /** Transition INTO this scene (overrides default) */
  transition?: TransitionSpec;
  /** Timed sub-events within the scene (emphasis, highlights, reveals) */
  beats?: Beat[];
}

interface Beat {
  /** Seconds after scene start */
  at: number;
  /** What to do */
  action:
    | { type: "emphasize"; target: string }
    | { type: "highlight-line"; line: number }
    | { type: "reveal"; index: number }
    | { type: "annotate"; text: string; position: "top" | "bottom" | "left" | "right" }
    | { type: "fx"; name: string; params?: Record<string, unknown> };
}

interface TransitionSpec {
  type: "cut" | "fade" | "slide-left" | "slide-right" | "zoom-in" | "dissolve";
  durationMs: number;
}
```

---

## Visual Primitives Catalog

Each primitive is a showboxes template (registered in `templates/registry.ts`). The Producer selects one per scene and fills its content slots.

### Existing (already built)

#### `title-bullets`
**Use for:** Section headings with supporting points. Quick facts. Recommendations.
```typescript
{
  primitive: "title-bullets",
  content: {
    title: "What This App Does",
    bullets: [
      "Manages user authentication via OAuth",
      "Syncs data with a PostgreSQL database",
      "Serves a React frontend from an Express server"
    ],
    titleFx: [{ name: "slam", duration: 600 }]
  }
}
```

#### `code-zoom`
**Use for:** Showing specific code with line highlighting. Entry points. Patterns. Problems.
```typescript
{
  primitive: "code-zoom",
  content: {
    code: "export async function authenticate(req, res) {\n  const token = req.headers.authorization;\n  // ... 🔍 no validation here\n}",
    language: "typescript",
    highlight: [3],
    startScale: 0.15
  }
}
```

### New Primitives to Build

#### `flow-diagram` (Three.js — Stage3D)
**Use for:** Architecture. Data flow. Module dependencies. Request paths.

Renders a directed graph of labeled nodes connected by edges. Nodes can be grouped. Simple — not a full diagramming tool, more like an animated whiteboard sketch.

```typescript
{
  primitive: "flow-diagram",
  content: {
    nodes: [
      { id: "client", label: "Browser", icon: "monitor", group: "frontend" },
      { id: "api", label: "API Server", icon: "server", group: "backend" },
      { id: "auth", label: "Auth Service", icon: "shield", group: "backend" },
      { id: "db", label: "PostgreSQL", icon: "database", group: "data" }
    ],
    edges: [
      { from: "client", to: "api", label: "REST" },
      { from: "api", to: "auth", label: "verify token" },
      { from: "api", to: "db", label: "queries" }
    ],
    groups: [
      { id: "frontend", label: "Frontend", color: "palette.primary" },
      { id: "backend", label: "Backend", color: "palette.secondary" },
      { id: "data", label: "Data Layer", color: "palette.accent" }
    ],
    /** Nodes appear one by one with this delay between each */
    staggerMs: 300,
    /** Layout algorithm hint */
    layout: "left-to-right" | "top-to-bottom" | "radial"
  }
}
```

**Implementation notes:**
- Three.js r128 (already stubbed in Stage3D.ts)
- Nodes as rounded boxes with text (CSS3DRenderer for crisp text, or SpriteText)
- Edges as lines/arrows with optional labels
- Camera slowly orbits or can be fixed
- Entrance animation: nodes fade/grow in with stagger, edges draw after both endpoints are visible
- Keep it simple — no drag/drop, no editing, just animated display

#### `purpose-bullets` (enhanced title-bullets)
**Use for:** Explaining what a module/function/file does with structured supporting evidence.

Like `title-bullets` but with a purpose-driven layout: a heading states the purpose, sub-items support it with evidence or detail, and an optional "file reference" badge anchors it to the code.

```typescript
{
  primitive: "purpose-bullets",
  content: {
    purpose: "Handles all user authentication and session management",
    fileRef: "src/services/auth.ts",
    supports: [
      { point: "OAuth2 flow with Google and GitHub providers", type: "feature" },
      { point: "JWT tokens with 24-hour expiry", type: "detail" },
      { point: "No refresh token rotation — sessions die on expiry", type: "concern" },
      { point: "Rate limiting on login attempts (good practice)", type: "strength" }
    ],
    /** Bullet type drives icon/color: feature=blue, detail=gray, concern=amber, strength=green */
  }
}
```

#### `emphasis-word` (canvas fx-driven)
**Use for:** Key terms, verdict statements, dramatic reveals. The "mic drop" moment.

A single word or short phrase rendered large on the canvas with a dramatic entrance effect. Optionally followed by supporting text that fades in below.

```typescript
{
  primitive: "emphasis-word",
  content: {
    word: "FRAGILE",
    subtitle: "This codebase has no tests and 3 god functions over 500 lines each.",
    fx: [
      { name: "slam", duration: 520 },
      { name: "glow", duration: 1400, strength: 48, color: "#ff6b6b" },
      { name: "shake", duration: 400, intensity: 8 }
    ],
    /** Style override — lets the Producer match the word to the persona */
    style: {
      size: 120,
      weight: "900",
      color: "#ff6b6b"
    }
  }
}
```

#### `center-stage` (canvas + DOM hybrid)
**Use for:** Central concept with supporting ideas radiating outward. Good for "this is the core of the app" or "these are the key dependencies."

A concept word/phrase in the center of the canvas, with related terms arranged in a circle/orbit around it. Terms can pulse or glow to show relative importance.

```typescript
{
  primitive: "center-stage",
  content: {
    center: { text: "Presenter", size: 72 },
    orbiting: [
      { text: "Stage", weight: 0.9 },
      { text: "TextBox", weight: 0.8 },
      { text: "fx registry", weight: 0.7 },
      { text: "Templates", weight: 0.85 },
      { text: "DOM Layer", weight: 0.6 },
      { text: "Stage3D", weight: 0.3 }
    ],
    /** Weight drives size and glow intensity (0-1) */
    /** Animation: center appears first, then orbiters stagger in */
    staggerMs: 200,
    /** Optional: slow orbit rotation */
    orbitSpeed: 0.001
  }
}
```

#### `code-cloud` (DOM-based)
**Use for:** Showing the relative importance of concepts, modules, dependencies, or patterns across the codebase. Like a word cloud but tuned for code concepts.

```typescript
{
  primitive: "code-cloud",
  content: {
    items: [
      { text: "React", weight: 1.0, category: "framework" },
      { text: "Express", weight: 0.9, category: "framework" },
      { text: "useState", weight: 0.85, category: "pattern" },
      { text: "prisma", weight: 0.7, category: "orm" },
      { text: "JWT", weight: 0.6, category: "auth" },
      { text: "WebSocket", weight: 0.4, category: "transport" },
      { text: "Redis", weight: 0.3, category: "cache" }
    ],
    /** Category → color mapping (or use palette) */
    categoryColors: {
      framework: "palette.primary",
      pattern: "palette.secondary",
      orm: "palette.accent",
      auth: "#f59e0b",
      transport: "#8b5cf6",
      cache: "#ef4444"
    },
    /** Animation: items appear with random stagger, float gently */
    entranceStyle: "scatter" | "spiral" | "typewriter"
  }
}
```

**Implementation notes:**
- DOM-based (not canvas) for crisp text at any size
- `weight` maps to font size (0.0 → smallest, 1.0 → largest)
- Positioned using a force-directed or spiral packing algorithm
- Gentle floating animation after placement (CSS transform + transition)
- Click/hover could highlight all items of the same category (stretch goal)

#### `transform-grid` (DOM-based)
**Use for:** Showing the gradual transformation of data, a refactoring sequence, a build pipeline, or any "before → stages → after" narrative.

A horizontal sequence of panels showing an object/concept changing through stages. Each panel is a snapshot with a label underneath.

```typescript
{
  primitive: "transform-grid",
  content: {
    title: "How a request becomes a response",
    stages: [
      {
        label: "Raw Request",
        display: { type: "code", code: "POST /api/login\n{email, password}", language: "http" }
      },
      {
        label: "Validated",
        display: { type: "code", code: "{ email: 'rick@...', password: '••••' }", language: "json" }
      },
      {
        label: "Authenticated",
        display: { type: "text", text: "✓ Credentials match\n→ Generate JWT" }
      },
      {
        label: "Response",
        display: { type: "code", code: "200 OK\n{ token: 'eyJhbG...' }", language: "http" }
      }
    ],
    /** Stages reveal left-to-right with arrow connectors between them */
    staggerMs: 600,
    /** Arrow style between panels */
    connector: "arrow" | "chevron" | "fade"
  }
}
```

**Implementation notes:**
- CSS grid/flexbox layout
- Each stage is a card with optional code highlighting (reuse Prism)
- Connector arrows drawn with SVG or CSS pseudo-elements
- Entrance: stages slide in from the right, one by one
- Active stage gets a subtle glow/border highlight

---

## Script Player Runtime

The Script Player is a client-side TypeScript class that sits between the `PresentationScript` and the `Presenter`. It doesn't generate content — it orchestrates playback.

```typescript
class ScriptPlayer {
  private script: PresentationScript;
  private presenter: Presenter;
  private currentScene: number = 0;
  private beatTimers: number[] = [];
  private voicePlayer: VoicePlayer;

  constructor(script: PresentationScript, presenter: Presenter, voicePlayer: VoicePlayer) {
    this.script = script;
    this.presenter = presenter;
    this.voicePlayer = voicePlayer;
  }

  /** Start playback from the current scene */
  play(): void;

  /** Pause playback (freezes scene, pauses voice) */
  pause(): void;

  /** Jump to a specific scene by index or ID */
  seek(target: number | string): void;

  /** Advance to next scene */
  next(): void;

  /** Go back one scene */
  prev(): void;

  /** Current playback state */
  get state(): "playing" | "paused" | "ended";

  /** Progress info for a seek bar */
  get progress(): { scene: number; total: number; elapsed: number; duration: number };
}
```

**Scene lifecycle:**
1. Clear previous scene (`presenter.clear()`)
2. Apply transition (if any)
3. Render the primitive (`presenter.present({ template: scene.primitive, content: scene.content })`)
4. Start narration (`voicePlayer.speak(scene.narration)`)
5. Schedule beats (emphasis, highlights, reveals at specified timestamps)
6. Wait for `max(narration duration, holdSeconds)`
7. Advance to next scene (or end)

---

## Data Flow Summary

```
User enters GitHub URL + settings
         │
         ▼
  ┌──────────────┐
  │  Server /    │
  │  Orchestrator│──── Clone URL, validate, check rate limits
  │              │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐     AnalysisJSON
  │  Agent 1     │─────────────────┐
  │  (Managed    │                 │
  │   Agents API)│                 │
  └──────────────┘                 │
                                   │
  ┌──────────────┐                 │   UserSettings
  │  Agent 2     │◄────────────────┤◄──────────────
  │  (API call   │                 │
  │   or Managed)│                 │
  └──────┬───────┘                 │
         │                         │
         │  PresentationScript     │
         ▼                         │
  ┌──────────────┐                 │
  │  Client      │                 │
  │  Script      │                 │
  │  Player      │                 │
  └──────┬───────┘
         │
         ├──► Presenter (canvas + DOM + 3D)
         └──► VoicePlayer (TTS audio)
```

---

## User Settings Schema

These travel from the UI to Agent 2 as part of its context.

```typescript
interface UserSettings {
  /** GitHub repo to analyze */
  repoUrl: string;

  /** 0.0 = "explain it to my mom", 1.0 = "I'm the senior architect" */
  audienceLevel: number;

  /** 0.0 = executive summary, 1.0 = line-by-line deep dive */
  detailLevel: number;

  /** 0.0 = slow and deliberate, 1.0 = fast and dense */
  pace: number;

  /** Personality template for the presentation */
  persona: "corporate" | "character" | "friendly" | "stern";

  /** Voice synthesis settings */
  voice: {
    provider: "elevenlabs" | "kokoro";
    voiceId: string;
    /** 0.5 = slow, 1.0 = normal, 1.5 = fast */
    speed: number;
  };

  /** Optional focus areas — if empty, analyze everything */
  focusAreas?: string[];

  /** Optional: specific files or directories to prioritize */
  priorityPaths?: string[];
}
```

**How settings influence each agent:**

| Setting | Agent 1 (Analyst) | Agent 2 (Producer) |
|---------|-------------------|--------------------|
| `audienceLevel` | — (always produces full analysis) | Controls jargon level, analogy density, code vs. diagram ratio |
| `detailLevel` | — (always produces full analysis) | Controls number of scenes, depth per topic |
| `pace` | — | Controls `holdSeconds`, narration length, beat density |
| `persona` | — | Controls tone, visual style, fx choices, transition style |
| `voice` | — | Embedded in script `defaults.voice` for the Player |
| `focusAreas` | Included in task description | Determines which analysis sections get more scenes |
| `priorityPaths` | Included in task description | Determines which files get `code-zoom` treatment |

Agent 1 always produces the same comprehensive analysis regardless of settings. The settings shape the *presentation*, not the *analysis*. This means a user can re-render the same analysis with different settings without re-running Agent 1.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vite + React + TypeScript | Already in place |
| Canvas rendering | Canvas 2D + anime.js | Already in place (Stage, TextBox, fx) |
| 3D rendering | Three.js r128 | Stubbed (Stage3D). No WebGL dep today |
| Syntax highlighting | Prism.js | Already in place (code-zoom) |
| Voice synthesis | ElevenLabs API / Kokoro | New — client-side or server-proxied |
| Agent 1 runtime | Anthropic Managed Agents API | Server-side. Built-in toolset for file access |
| Agent 2 runtime | Anthropic Messages API (or Managed Agents) | Server-side. Pure reasoning, no tools needed |
| Server | Node.js (Express or Hono) | New — handles OAuth, orchestration, agent calls |
| Auth | GitHub OAuth | New — for private repo access |
| Database | SQLite or Postgres | Optional — cache analyses, store user settings |

---

## Build Order (suggested)

### Phase 0 — Prove the primitives (no agents)
Build and test each visual primitive with hardcoded data. Get them looking right in the existing demo host (`App.tsx`). This is pure frontend work.

1. `purpose-bullets` template (extend `title-bullets`)
2. `emphasis-word` template (thin wrapper around showTextBox + fx)
3. `center-stage` template (canvas positioning + stagger animation)
4. `code-cloud` template (DOM layout + floating animation)
5. `transform-grid` template (DOM grid + stagger reveal)
6. `flow-diagram` template (Three.js Stage3D implementation)

### Phase 1 — Script Player
Build the `ScriptPlayer` class that reads a `PresentationScript` and drives the `Presenter`. Test with a hand-written script JSON. No agents yet — just prove the playback runtime works.

### Phase 2 — Agent 1 integration
Stand up a minimal server. Wire the Code Analysis agent (Managed Agents API). Accept a GitHub URL, run the analysis, return `AnalysisJSON`. Store it.

### Phase 3 — Agent 2 integration
Wire the Producer/Director agent. Feed it `AnalysisJSON` + hardcoded settings. Get back a `PresentationScript`. Play it.

### Phase 4 — UI and settings
Build the input page: GitHub URL, OAuth, sliders, voice picker, template chooser. Wire settings through to Agent 2.

### Phase 5 — Voice
Integrate ElevenLabs or Kokoro TTS. Generate audio per scene. Sync playback with the Script Player.

### Phase 6 — Polish
Transitions between scenes. Loading states. Error handling. Caching analyses. Re-rendering with different settings.

---

## Resolved Decisions

### Agent 2 runs on Messages API (not Managed Agents)
The Producer/Director is a pure reasoning task — analysis JSON in, presentation script out. A single `messages.create` call with `tool_use` for the script schema is the right weight. No plan/approve gate needed; the user controls the output via settings sliders, and regeneration is cheap.

### Pre-generation for voice audio
Users will expect this to take a couple of minutes. The flow is: analyze (60-120s) → generate script (10-20s) → generate all voice audio (30-60s) → ready to play. A progress indicator walks the user through each stage.

### Large repo handling: Agent 1 returns a choice
For repos over ~300 files, the analysis agent's first pass produces a **triage response** instead of a full analysis. The triage identifies the major subsystems and asks the user: *"Should we focus on how this app handles authentication, or do a high-level overview of the whole thing?"* The user picks a focus, and Agent 1 runs a targeted deep analysis. This keeps context windows manageable and produces better presentations (a focused 20-scene presentation beats a shallow 50-scene one).

### Re-rendering without re-analyzing
The analysis is cached. When a user tweaks settings (audience, pace, persona) and hits "Regenerate," only Agent 2 re-runs. The UI makes this clear: *"Your analysis is ready. Adjust settings and regenerate the presentation."*

### Server: Next.js on Vercel
Domain: **codesplain.io**. Next.js App Router. Server Actions or API routes for agent orchestration. Vercel deployment with serverless functions for the agent calls (may need longer function timeouts for Agent 1 — Vercel Pro/Enterprise, or a background job pattern).

---

## Private Repo Auth: The Vault Constraint

The Managed Agents beta does NOT allow injecting secrets as environment variables into the agent's bash container. Credentials flow through a **Vault** system:

1. You create a Vault and store the user's GitHub token in it (as a `static_bearer` credential tied to `https://mcp.github.com/mcp`).
2. When creating a session, you pass `vault_ids: [vault.id]`.
3. The agent accesses GitHub through the GitHub MCP server, and the platform injects the token into the MCP connection automatically.
4. The token **never appears** in the agent's shell environment, logs, or message content.

**What this means for codesplain.io:**

You cannot do `git clone https://token@github.com/user/repo.git` from the agent's bash. Two viable approaches:

**Option A — GitHub MCP server (beta-native)**
Configure the agent with GitHub's MCP server. The agent uses MCP tools to read files, list directories, search code — no `git clone` needed. Vault handles auth transparently.

```typescript
// Agent creation
const agent = await managedAgentsApi("POST", "/v1/agents?beta=true", {
  name: "code-analysis-gnome",
  model: "claude-sonnet-4-5",
  system: systemPromptTemplate,
  mcp_servers: [
    { type: "url", name: "github", url: "https://mcp.github.com/mcp" }
  ],
  tools: [
    { type: "agent_toolset_20260401" },
    {
      type: "mcp_toolset",
      mcp_server_name: "github",
      default_config: { permission_policy: { type: "always_allow" } }
    }
  ]
});

// Session creation with user's vault
const session = await managedAgentsApi("POST", "/v1/sessions?beta=true", {
  agent: agent.id,
  environment_id: envId,
  vault_ids: [userVaultId]
});
```

**Option B — Server-side clone (simpler, no vault needed)**
The Next.js server clones the repo using the user's OAuth token, then passes the file tree to Agent 1 as context. The agent never touches GitHub directly.

```
User → Next.js server → git clone (with OAuth token) → tar/zip the source
     → Send to Agent 1 as initial message attachment or via a file-serving endpoint
```

This sidesteps the vault system entirely. The tradeoff: you're loading the codebase into the initial message (large context) or hosting it for the agent to fetch. For public repos, this is trivially `git clone` on the server with no auth needed.

**Recommendation for v1:** Start with public repos only (no auth needed — Agent 1 just `git clone`s directly). Add private repo support via Option A (GitHub MCP + Vault) in v2 once you've validated the core product.

---

## Remaining Open Questions

1. **Vercel function timeout.** Agent 1 can run 60-120 seconds. Vercel's default serverless timeout is 10s (Hobby) / 60s (Pro) / 900s (Enterprise). May need Vercel's background functions, or an async pattern where the client polls for completion.

2. **Voice provider integration.** ElevenLabs has a streaming API and a pre-generation API. Kokoro is open-source and could run locally or on a GPU endpoint. The pre-generation choice simplifies this — generate all scene audio as individual clips, stitch or play sequentially.

3. **Script Player sync precision.** With pre-generated audio, the Player needs to know each clip's duration to schedule beats accurately. Either embed duration in the script (Agent 2 estimates) or measure actual audio duration after generation and adjust beat timings.
