# Gnome Kit — Extract for Porting

This folder is a **reference extract**, not a runnable package. It contains
every file from marymary that implements the "gnome" concept — user-editable
agent definitions driven by a Handlebars system-prompt template — so you can
lift the pattern into a new project without dragging marymary's Project /
Tactic / Task / WorkProduct world along with it.

## The concept in one paragraph

A **gnome** is a row in the database that describes a single agent's behavior:
name, icon, model, max tokens, which tool providers it can use, which work
product types it can produce, and — the interesting part — a **Handlebars
system prompt template** that references runtime variables. At execution
time, the template engine flattens an `AgentContext` (project, task, metrics,
tools, knowledge, work product rules, previous attempts) into a variable
namespace and renders the template. Users can fork a shipped default
(copy-on-write via `isBuiltIn` / `builtInSlug`) and edit the prompt, but the
pre-rendered sections like `{{metricsSection}}` and `{{toolsSection}}` are
injected by code — so authors can't forget or misspell the runtime context.
Each gnome also mirrors itself to an Anthropic Managed Agent on every save,
via `syncGnomeToManagedAgent()`.

## What's in this folder

```
extract-gnome-kit/
├── agents/
│   ├── template.ts            ← THE HEART. Handlebars compile + AgentContext flattening.
│   ├── types.ts               ← AgentDefinition, AgentContext, ToolProviderType, etc.
│   ├── resolve.ts             ← Adapter: Gnome row → AgentDefinition at runtime.
│   ├── defaults/              ← All shipped built-in gnomes (reference examples).
│   │   ├── types.ts           ← BuiltInGnomeData interface.
│   │   ├── index.ts           ← getAllBuiltInGnomes() / getBuiltInGnome()
│   │   ├── research.defaults.ts        ← best reference — shows full template usage
│   │   ├── designer.defaults.ts
│   │   ├── content-marketing.defaults.ts
│   │   ├── social-media.defaults.ts
│   │   ├── community.defaults.ts
│   │   ├── store-presence.defaults.ts
│   │   ├── loan-processing.defaults.ts
│   │   └── general.defaults.ts
│   ├── tools/
│   │   └── registry.ts        ← Tool provider registration (read/write tools per platform).
│   ├── execution/
│   │   └── research.execution.ts    ← Example per-gnome execution override (referenced by resolve.ts).
│   ├── definitions/           ← LEGACY AgentDefinition world. resolve.ts falls back to these
│   │                            when a tactic has no matching DB gnome. Useful to read side-by-side
│   │                            with defaults/ to see how the two patterns coexist.
│   │   ├── index.ts
│   │   ├── community.agent.ts
│   │   ├── content-marketing.agent.ts
│   │   ├── social-media.agent.ts
│   │   ├── store-presence.agent.ts
│   │   ├── loan-processing.agent.ts
│   │   └── general.agent.ts
│   └── managed-agents/
│       ├── client.ts          ← Thin fetch wrapper around Anthropic Managed Agents REST API.
│       ├── sync.ts            ← syncGnomeToManagedAgent() — idempotent upsert.
│       ├── builtin-registry.json       ← snapshot of shipped slugs used by the sync layer
│       └── platform-tools/    ← Provider-side tool declarations (web_search, twitter, etc.)
│           ├── registry.ts
│           ├── types.ts
│           ├── index.ts
│           └── providers/     ← individual tool provider files
│
├── services/
│   ├── gnome.service.ts       ← CRUD + copy-on-write fork + listEffectiveGnomes()
│   │                            (merges DB rows with virtual built-ins).
│   ├── agent.service.ts       ← Orchestration: plan → approve → execute lifecycle on top of a gnome.
│   └── agent.session.service.ts  ← Managed Agents session handling: resolveAgentExternalId,
│                                   open remote session, poll-until-idle, stream tool calls back.
│
├── components/
│   ├── GnomeModal.tsx         ← View / edit / create a gnome. Handlebars-aware textarea.
│   ├── GnomeShowcaseModal.tsx ← Read-only "meet the gnome" detail card.
│   ├── GnomeChip.tsx          ← Compact badge used in schedule/list views.
│   └── AssignAgentModal.tsx   ← Pick a gnome to assign to a task.
│
├── api/
│   └── projects/gnomes/       ← Next.js route handlers (renamed from [slug]/gnomes)
│       ├── route.ts                  ← GET (list effective) / POST (create)
│       ├── [gnomeId]/route.ts        ← GET / PATCH / DELETE one
│       └── [gnomeId]/reset/route.ts  ← POST — reset a forked built-in to shipped defaults
│
├── mcp/
│   ├── gnomes.ts              ← MCP tool surface: list_gnomes, get_gnome, update_gnome (CRUD)
│   └── agents.ts              ← MCP tool surface: assign_agent — pick a gnome, kick off a run
│
├── prisma/
│   └── schema-gnome.prisma    ← Trimmed schema: Gnome + ManagedAgentEnvironment + TacticCategory enum
│
└── README-EXTRACT.md          ← you are here
```

## The four files you MUST read first

If you're porting this, read these in order. Everything else is supporting cast.

1. **`agents/template.ts`** — 135 lines, self-contained, explains the whole
   pattern. Understand `flattenAgentContext()` and `renderPromptTemplate()`
   before anything else.
2. **`agents/defaults/research.defaults.ts`** — the best example of a
   well-written `systemPromptTemplate`. Shows how to use every pre-rendered
   section and every context variable.
3. **`services/gnome.service.ts`** — CRUD, copy-on-write forking, and the
   `EffectiveGnome` type that the UI operates on.
4. **`agents/managed-agents/sync.ts`** — the idempotent
   upsert-to-Anthropic-Managed-Agents flow. This is where the "one gnome =
   one managed agent" contract lives.
5. **`services/agent.session.service.ts`** — how a gnome is actually
   *invoked* at runtime: resolve the remote `externalAgentId`, open a
   Managed Agents session, poll until idle, handle tool calls. This is
   the other half of the loop that `sync.ts` starts.

## Dependencies the extracted files expect

Every file here was written against marymary's path aliases and library
choices. When you paste into a new repo, expect to rewire these:

### Path aliases

| Alias                | marymary path             | What to do in the new repo                                 |
|----------------------|---------------------------|------------------------------------------------------------|
| `@/agents/*`         | `src/agents/*`            | Repoint to wherever you drop `agents/`                     |
| `@/services/*`       | `src/services/*`          | Repoint to your services folder                            |
| `@/components/*`     | `src/components/*`        | Repoint to your components folder                          |
| `@/lib/prisma`       | `src/lib/prisma.ts`       | Create a prisma client singleton in the new repo          |
| `@/lib/errors`       | `src/lib/errors.ts`       | `NotFoundError`, `ValidationError`, `ConflictError` classes — trivial to re-create |
| `@/lib/api-utils`    | `src/lib/api-utils.ts`    | `withAuthHandler`, `withServiceHandler`, `parseBody`, `getSearchParams` — Next.js helpers, easy to rewrite |
| `@/workproducts/*`   | `src/workproducts/*`      | **Not included.** See "Work products" below.               |

### npm packages

- `handlebars` — **required**. This is the template engine. `npm i handlebars`.
- `@prisma/client` — required (generates types from `schema-gnome.prisma`).
- `@modelcontextprotocol/sdk` — only if you want the MCP surface (`mcp/gnomes.ts`).
- `zod` — used by the MCP tool and API routes for input validation.
- `react` — required for the `components/` files.
- Next.js App Router — the `api/` routes are Next.js route handlers.

### Prisma imports that come "for free" from marymary's full schema

The extracted TypeScript files import these Prisma types:

- `TacticCategory` — included in `schema-gnome.prisma`.
- `Gnome` — included.
- `Task`, `Tactic`, `Project`, `MetricSource` — **NOT included**. Used by
  `agents/types.ts` to describe `AgentContext`. You'll need to either:
  (a) define equivalent interfaces in the new project that match your domain,
  or (b) delete the fields from `AgentContext` that don't apply and update
  `flattenAgentContext()` to match. **Almost certainly (b) is what you want**
  because the new project isn't going to have Projects/Tactics/Tasks.
- `Prisma` namespace — used by `gnome.service.ts` for input types. Will
  regenerate cleanly from the trimmed schema.

## Work products — the one thing NOT copied

`agents/types.ts` imports `JsonSchema` and `PreviousWorkProduct` from
`@/workproducts/types` and there are many references to `submit_work_product`
in the default gnome templates. **I deliberately did not copy the
`workproducts/` folder** because it's a whole subsystem of its own (schema
definitions, review flow, revision tracking, structured output delivery) and
porting it belongs in a separate decision.

For the new project you have three reasonable options:

1. **Skip work products entirely.** Delete `targetWorkProductSchema`,
   `previousWorkProduct`, `sourceWorkProduct` from `AgentContext` and the
   corresponding pre-rendered sections from `flattenAgentContext()`. The
   gnome just returns prose. Simplest, and probably right if the new agent
   is returning a single code explanation that will be rendered on a web
   page.
2. **Stub a minimal work product schema.** Keep the shape of
   `targetWorkProductSchema` (a JSON schema + a `submit_work_product` tool)
   but ship exactly one definition — the shape your web page needs. This
   preserves the "agent delivers structured output" pattern without
   importing marymary's whole registry.
3. **Port the full workproducts subsystem later.** Treat this extract as
   Phase 1 and schedule the workproducts lift separately.

I'd go with option 2 for your code-explainer use case: one schema, one
rendering target, but you keep the "agent must call submit_work_product
exactly once" contract that makes the output reliable.

## What you probably want to DELETE from the extract

The extract is intentionally generous — easier to delete than to re-find
later — but for a single-purpose agent that lives next to other tools,
you'll almost certainly strip:

- **All default gnomes except one**: `designer`, `content-marketing`,
  `social-media`, `community`, `store-presence`, `loan-processing`,
  `general`, and probably `research` too. Keep whichever is closest to
  your new agent's shape as a template.
- **`agents/managed-agents/platform-tools/providers/*`**: most of the
  individual provider files (twitter, steam, etc.) are marymary-specific.
  Keep `web-search.ts` and `media-library.ts` as reference if useful;
  delete the rest. You'll write a new provider file for whatever tools
  your code-explainer needs (probably a file-reading tool).
- **`agents/execution/research.execution.ts`**: included for reference
  only. It's a per-gnome execution override specific to the research
  gnome (pre-fetches URLs via Browserless before sending content to
  Claude). The pattern is useful to see — keep it if you need a similar
  per-agent hook, delete it otherwise.
- **`agents/definitions/`**: included for reference only. These are an
  older `AgentDefinition`-first pattern that predates gnomes. `resolve.ts`
  imports from it as a fallback for tactic-category resolution — drop
  that branch if your new project resolves agents by slug only.
- **`TacticCategory` enum**: almost certainly wrong for the new domain.
  Replace with your own taxonomy or drop entirely and make `categories`
  a plain `String[]` of tags.

## The minimum viable port (shortest path to "it works")

If all you want is a single managed agent with a Handlebars prompt and a
web page that shows its output, you can get there by keeping only:

```
agents/template.ts                    ← template engine (trim AgentContext)
agents/types.ts                       ← trim: drop Project/Tactic/Task, keep what you need
agents/managed-agents/client.ts       ← Anthropic Managed Agents client
agents/managed-agents/sync.ts         ← trim: one-gnome version
services/gnome.service.ts             ← trim: skip dual-scope, skip categories
services/agent.session.service.ts     ← trim: remove plan/approve dance, keep session + invocation
components/GnomeModal.tsx             ← the edit UI (trim categories, tool providers you don't need)
prisma/schema-gnome.prisma            ← trim: drop TacticCategory, rewire relations
```

That's ~8 files. Everything else in this folder is reference.

## Porting checklist

- [ ] Decide: keep `TacticCategory` enum, replace it, or drop it?
- [ ] Decide: dual-scope (project + org) or single parent?
- [ ] Decide: copy-on-write built-ins, or just one hand-written gnome?
- [ ] Decide: full work products subsystem, stub schema, or none?
- [ ] Decide: MCP tool surface needed? (skip if the new project isn't exposing gnomes over MCP)
- [ ] Rewrite `agents/types.ts` `AgentContext` to match the new domain
- [ ] Rewrite `flattenAgentContext()` pre-rendered sections accordingly
- [ ] Create `lib/prisma.ts` singleton in the new repo
- [ ] Create `lib/errors.ts` with `NotFoundError`, `ValidationError`, `ConflictError`
- [ ] Wire `ANTHROPIC_API_KEY` + `MANAGED_AGENTS_ENVIRONMENT_SLUG` env vars
- [ ] Seed a `ManagedAgentEnvironment` row (1-row table)
- [ ] Replace path aliases in every file
- [ ] Run `prisma migrate dev` with the trimmed schema
- [ ] Write ONE default gnome for the new use case
- [ ] Verify `syncGnomeToManagedAgent()` upserts cleanly on create/update

## A note on the copy

Files were copied verbatim. I did NOT modify imports, rename symbols, or
strip marymary-specific references. That's intentional — you can diff the
extract against the live marymary source to verify nothing was lost, and
the porting work happens in the new repo where you have the target
project's conventions in front of you.

The only structural change is that the API route folders were renamed
from `[slug]/gnomes/*` to `projects/gnomes/*` so they live under the
new repo's parent URL segment (rename to match your actual route prefix).
