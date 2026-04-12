# Code Analysis Gnome — Integration Guide

## What's in this kit

Two files, both already in the extract-gnome-kit:

```
agents/defaults/code-analysis.defaults.ts    ← gnome definition + system prompt
agents/managed-agents/platform-tools/providers/code-analysis.ts  ← Phase 2 submit tool + schema
```

## Phase 1 — Prose output (quickest path to running)

Phase 1 uses the gnome's system prompt and the built-in managed agent toolset
(bash, file tools, web search) to clone a repo and produce a prose analysis.
No custom tools needed — the gnome writes its analysis as standard execution output.

### Steps

1. **Register the gnome default** in `agents/defaults/index.ts`:

```ts
import { codeAnalysisGnome } from "./code-analysis.defaults";

// Add to the allBuiltInGnomes array:
export const allBuiltInGnomes: BuiltInGnomeData[] = [
  // ... existing gnomes ...
  codeAnalysisGnome,
];
```

2. **Sync to Managed Agents.** Run the seed script (`pnpm managed-agents:seed`)
   to push the new gnome to Anthropic as a remote Agent. Alternatively, if you
   have the `syncBuiltInGnomeToManagedAgent` flow running on deploy, it'll pick
   it up automatically.

3. **Create a tactic + task.** The gnome is cross-cutting (no category), so assign
   it by slug. Create a task whose description contains the repo URL:

```
Title: Analyze the showboxes codebase
Description: Clone https://github.com/youruser/showboxes and produce a full
analysis: architecture, code quality, and plain-English explanation.
Focus areas: canvas rendering pipeline, template system, effect registry.
```

4. **Assign the gnome** via MCP or UI:

```
assign_agent(taskId, gnomeSlug: "code-analysis-gnome")
```

5. **Review the plan**, approve, and let it execute. The gnome will clone the
   repo, explore it using the built-in file tools, and produce its analysis
   as prose output in the execution result.

### What you get

A detailed text report with five sections:
- Quick Facts (stack, size, deps)
- Architecture (entry points, modules, data flows)
- Code Quality (patterns, hotspots, debt, security, strengths)
- What This App Does (plain-English walkthrough)
- Health & Recommendations (verdict, risks, wins, reading order)

---

## Phase 2 — Structured output (for the presentation pipeline)

Phase 2 adds the `submit_code_analysis` custom tool so the gnome delivers
structured JSON instead of prose. This is what the Presenter Gnome will consume.

### Additional steps

1. **Add `code_analysis` to `ToolProviderType`** in `agents/types.ts`:

```ts
export type ToolProviderType =
  | "twitter"
  | "instagram"
  // ... existing ...
  | "code_analysis";  // ← add this
```

2. **Register the platform tool.** Import the provider file in
   `agents/managed-agents/platform-tools/providers/index.ts` (or wherever
   your side-effect imports live):

```ts
import "./code-analysis";
```

3. **Update the gnome default** to include the new provider and work product:

```ts
toolProviders: ["web_search", "code_analysis"],
producibleWorkProducts: ["code-analysis-report"],
```

4. **Remove the `as any` cast** in `code-analysis.ts` once the type union
   is updated.

5. **Wire the dispatcher** in `agent.session.service.ts`. The
   `submit_code_analysis` tool follows the same `requires_action` → dispatch
   pattern as `marymary_submit_work_product`. On receiving the structured JSON:
   - Store it on the execution row (e.g. `workProductData` column)
   - Resolve the tool call with `{ accepted: true }`
   - Optionally kick off the Presenter Gnome as a downstream task

6. **Re-seed** to push the updated tools to the remote Agent.

### The analysis schema

The full JSON Schema is exported as `CODE_ANALYSIS_SCHEMA` from the provider
file. It defines five top-level sections:

- `quickFacts` — repo URL, languages, framework, file count, notable deps
- `architecture` — entry points, modules with dependency graph, data flows, external integrations, optional Mermaid diagram
- `codeQuality` — letter grade, patterns, complexity hotspots, tech debt, security, strengths
- `plainEnglish` — one-liner, full explanation, user journeys, analogies
- `health` — verdict, top 3 risks, top 3 wins, recommended reading order

This schema is the contract between the analysis gnome and anything downstream.
The Presenter Gnome, a web UI, or an export pipeline can all consume it reliably.

---

## Phase 3 — Presenter Gnome (future)

The Presenter Gnome takes the structured analysis JSON as `sourceWorkProduct`
context and transforms it into a visual presentation via showboxes. This is
a separate gnome with its own system prompt template — it doesn't analyze code,
it presents analysis results.

Key design decisions for Phase 3:
- The presenter's `sourceWorkProduct.data` is typed to `CODE_ANALYSIS_SCHEMA`
- The presenter emits showboxes directives (template selections, text box content, effects)
- The presenter's prompt template governs tone, pacing, and visual style
- Rick's "influence over the processing" lives here — the presenter prompt is where
  non-standard descriptions and visual thinking get encoded

---

## Environment variables

No new env vars needed for Phase 1. The gnome uses the existing
`ANTHROPIC_API_KEY` and `MANAGED_AGENTS_ENVIRONMENT_SLUG` from the
managed agents setup.

## Model selection

The default is `claude-sonnet-4-20250514` (maps to `claude-sonnet-4-5`
on the managed agents side). For larger repos or deeper analysis,
consider `claude-opus-4-6` — the extra reasoning capability pays off
when tracing complex data flows and writing good analogies.
