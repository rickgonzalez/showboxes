# Testing Workflow — Fixing Flagged Script Notes

> Short guide for a Claude session collaborating with Rick on issues
> captured from the player's flag button. Read this when the user says
> things like "let's work on the notes," "look at what I flagged," or
> "pick a template note to fix."

## First: context to load

Before diving into any note, in this order:

1. **Check `MEMORY.md`** — standing feedback, project state, and prior
   decisions live there. The entry "How to read ScriptNote rows" points
   at the lookup script; "ScriptNote is an internal tuning tool" explains
   why there's no GET endpoint.
2. **Skim [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)** — the three
   layers a note might be about (Agent 1 = analysis, Agent 2 = script,
   player templates) are defined there.
3. **Skim [`docs/TEMPLATE-SPEC.md`](../TEMPLATE-SPEC.md)** — needed any
   time a note's `suspectArea` is `template`, or when the fix might
   touch layout, safe area, or emphasize contracts.

Don't re-derive what's already in memory or those two docs.

## The three layers a note can be about

Every note carries a `suspectArea` — the reviewer's guess at which layer
is at fault. Your first job is to respect that tag (and push back if the
note text contradicts it).

| `suspectArea` | Layer | Where fixes usually land |
|---|---|---|
| `analysis` | Agent 1 produced wrong or off-tone content | `apps/server/lib/agents/` (Agent 1b prompt, `extract-gnome-kit` definitions, `renderModeDirective`) |
| `script` | Agent 2 picked the wrong template or wrote bad narration/content for the right template | `apps/server/lib/agents/producer.*` (system prompt, user message, tool schema) |
| `template` | The primitive itself rendered poorly (overflow, overlap, missing content) | `apps/player/src/templates/<id>.ts` + `apps/player/src/index.css` |
| `null` (untagged) | Reviewer wasn't sure — triage before fixing | — |

"Script" covers both "wrong template choice" and "bad narration for the
right template" — we decided one bucket is enough; refine from the note
text if needed.

## The workflow

### 1. Pull the queue

From `apps/server/`:

```
npx tsx scripts/list-notes.ts                           # all open notes
npx tsx scripts/list-notes.ts --suspect template        # open + template-suspected
npx tsx scripts/list-notes.ts --suspect untagged        # needs triage
npx tsx scripts/list-notes.ts --template flow-diagram   # everything against one template
npx tsx scripts/list-notes.ts --status all              # include resolved/wontfix
```

See the script header for the full flag set. This is the canonical read
path — don't add a GET endpoint or invent a new query surface.

### 2. Let Rick pick one

Show the open queue grouped by `suspectArea` (then by `sceneTemplate`).
Call out patterns — multiple notes on the same template usually mean a
template bug; multiple notes about "wrong template picked" usually mean
an Agent 2 prompt issue.

### 3. Triage if `suspectArea` is null

Read the note text carefully. "Words rendered vertically" is almost
always a `script` issue (wrong template chosen for the content).
"Too long, goes off screen" is almost always `template` (missing wrap /
safe-area). "Graded the repo, would anger the owner" is `analysis`
(tone/scope). Confirm with Rick before proceeding.

### 4. Investigate in the right place

- `template` → reproduce with the template's `demo` payload first. The
  demos are the de-facto schema docs (see TEMPLATE-SPEC §7). If the
  demo is fine and real content breaks it, the template is fragile —
  fix the template, not the content.
- `script` → read the Producer's system prompt
  (`producer.system-prompt.ts`) and the relevant section of the
  template catalog embedded in it. If the Producer keeps picking the
  wrong template, the fix is usually a sharper "when to use" / "when
  NOT to use" line for that template in the catalog.
- `analysis` → read the Agent 1b gnome definition and
  `renderModeDirective`. Tone/scope changes live in the system prompt.

### 5. Propose before editing

For anything non-trivial, describe the fix in 2–3 sentences and get
Rick's OK before changing files. He's flagged before (see
`feedback_static_templates.md`, `feedback_svg_over_3d.md`) that big
rewrites when a small tweak would do aren't welcome — default to the
smallest change that resolves the note.

### 6. Mark status when done

The script is read-only on purpose. Status transitions go through
pgAdmin or a one-off `prisma.scriptNote.update`:

```ts
// update one note
await prisma.scriptNote.update({
  where: { id: '<noteId>' },
  data: { status: 'resolved' },
});
```

Values: `open` → `in-progress` → `resolved` (or `wontfix`). Ask Rick
which before flipping — a fix landed in a branch isn't `resolved` yet.

## Conventions to honor while fixing

- **Calm > kinetic.** Per `feedback_static_templates.md`, new templates
  and template tweaks should skew static. Don't add continuous motion
  to solve a layout problem.
- **SVG+DOM > 3D** for diagrams, per `feedback_svg_over_3d.md`.
- **Use `clientWidth/Height`, not `getBoundingClientRect`**, when
  measuring a render surface, per `feedback_clientwidth_not_boundingrect.md`.
- **Follow TEMPLATE-SPEC §3** — fill mode, safe area, width tokens. A
  template that fights its declared fill mode looks broken next to the
  others.
- **Don't add a GET to `/api/notes`** — notes are internal tuning
  instrumentation, not a user surface.

## Quick reference

- Notes table: `ScriptNote` in
  [`apps/server/prisma/schema.prisma`](../../apps/server/prisma/schema.prisma)
- Read script: [`apps/server/scripts/list-notes.ts`](../../apps/server/scripts/list-notes.ts)
- Flag UI: `openFlag` / `submitFlag` in
  [`apps/player/src/App.tsx`](../../apps/player/src/App.tsx)
- Write endpoint: [`apps/server/app/api/notes/route.ts`](../../apps/server/app/api/notes/route.ts)
