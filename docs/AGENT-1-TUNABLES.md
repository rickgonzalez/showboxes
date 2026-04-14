# Agent 1 Tunables — Map of Levers (1a Triage → 1b Analysis)

Companion to [ARCHITECTURE.md](./ARCHITECTURE.md). This document inventories every
knob that influences Agent 1a (triage) and Agent 1b (deep / focused analysis), shows
how user choices made between them propagate, and lists the inconsistencies in depth
& focus that are currently in flight.

If you're tuning a run, this is the page to read.

---

## 1. Tunables in Agent 1a (Triage)

Source files: [code-triage.gnome.ts](../apps/server/lib/agents/code-triage.gnome.ts),
[triage-session.ts](../apps/server/lib/agents/triage-session.ts),
[submit-triage.tool.ts](../apps/server/lib/agents/submit-triage.tool.ts).

| Lever | Where it lives | Current value | Notes |
|---|---|---|---|
| `defaultModel` | [code-triage.gnome.ts:39](../apps/server/lib/agents/code-triage.gnome.ts#L39) | `claude-haiku-4-5-20251001` | Cheap & fast — correct for triage |
| Output token cap (prompt-side) | [code-triage.gnome.ts:90](../apps/server/lib/agents/code-triage.gnome.ts#L90) | "Do NOT exceed 4k output tokens" | Soft cap baked into prompt |
| `maxExecuteTokens` (session-side) | gnome-level default in Managed Agents | static `32k` per CS-3 | Inconsistency — see §4 |
| Files allowed to read | [code-triage.gnome.ts:68-73](../apps/server/lib/agents/code-triage.gnome.ts#L68-L73) | README + manifests + top-level configs only | Hard rule in prompt |
| Tree walk technique | [code-triage.gnome.ts:74](../apps/server/lib/agents/code-triage.gnome.ts#L74) | `find` / `ls` + extension counts | |
| Subsystem count target | [code-triage.gnome.ts:55](../apps/server/lib/agents/code-triage.gnome.ts#L55) | "3-8 major functional areas" | |
| Highlights count | [code-triage.gnome.ts:56](../apps/server/lib/agents/code-triage.gnome.ts#L56) | 1-3 | |
| Importance scoring heuristic | [code-triage.gnome.ts:81-83](../apps/server/lib/agents/code-triage.gnome.ts#L81-L83) | "size + how central per README" | |
| Large-repo guardrail threshold | [code-triage.gnome.ts:95](../apps/server/lib/agents/code-triage.gnome.ts#L95) | 100k+ files | |
| Poll interval / max attempts | [triage-session.ts:21-22](../apps/server/lib/agents/triage-session.ts#L21-L22) | 2000 ms / 90 attempts (~3 min) | |
| Tool schema (output shape) | [submit-triage.tool.ts](../apps/server/lib/agents/submit-triage.tool.ts) | `repoUrl, totalFiles, approxLines, languages, framework, buildTool, workspaces, entryPoints[], subsystems[], highlights[], notes` | The contract that flows 1a → modal → 1b |

---

## 2. Tunables in Agent 1b (Deep / Focused Analysis)

Source files: [code-analysis.gnome.ts](../apps/server/lib/agents/code-analysis.gnome.ts),
[render-prompt.ts](../apps/server/lib/agents/render-prompt.ts),
[analyze/route.ts](../apps/server/app/api/analyze/route.ts),
[session.ts](../apps/server/lib/agents/session.ts).

### 2a. Static prompt levers (always in effect)

| Lever | Where | Current value |
|---|---|---|
| `defaultModel` | [code-analysis.gnome.ts:42](../apps/server/lib/agents/code-analysis.gnome.ts#L42) | `claude-sonnet-4-5` |
| Maximum repo-size cutoff (prompt-side) | [code-analysis.gnome.ts:111](../apps/server/lib/agents/code-analysis.gnome.ts#L111) | "500+ files → focus on core" |
| Methodology phases | [code-analysis.gnome.ts:70-104](../apps/server/lib/agents/code-analysis.gnome.ts#L70-L104) | Clone → Architecture → Quality → Plain English → Synthesis |
| Output sections (5) | [code-analysis.gnome.ts:60-64](../apps/server/lib/agents/code-analysis.gnome.ts#L60-L64) | quickFacts / architecture / codeQuality / plainEnglish / health |
| `maxExecuteTokens` | gnome-level, per CS-3 note | static `32k` (not mode-aware) |
| Poll interval / attempts | [session.ts:30-31](../apps/server/lib/agents/session.ts#L30-L31) | 3000 ms / 200 attempts (~10 min) |

### 2b. Per-run levers ([render-prompt.ts](../apps/server/lib/agents/render-prompt.ts))

| Variable | Source | What it does |
|---|---|---|
| `repoUrl` | request body | Required |
| `focusAreas` | request body, optional | Free-text bullet injected into prompt |
| `priorityPaths` | request body, optional | Same — file/dir hint |
| `modeDirective` | derived from `mode` (post-triage choice) | The big one — see §3 |

---

## 3. How user choices in 1a propagate into 1b

The triage report fuels [TriageModal.tsx](../apps/player/src/pipeline/TriageModal.tsx); the modal returns an `AnalysisMode`; the route stuffs it into [`renderModeDirective`](../apps/server/lib/agents/render-prompt.ts#L36-L81) — which **only changes prompt text, not session knobs.**

| User action in modal | `AnalysisMode` payload | Effect in `renderModeDirective` | Effective file budget | Prose style |
|---|---|---|---|---|
| Picks **Overview** | `{ kind: 'overview' }` | Hardcoded "~30 files total, breadth over depth" | ~30 files **total** | "concise" |
| Picks **Focused brief** + subsystems + depth | `{ kind, subsystems[], depth: 0..1 }` | `Math.round(15 + depth * 35)` per subsystem; 3 prose bands | 15-50 files **per subsystem** | <0.34 = paragraph; 0.34-0.67 = bullets; ≥0.67 = detailed w/ citations |
| Picks **Scorecard** | `{ kind: 'scorecard' }` | "Prioritize codeQuality + health; arch & plainEnglish short" | ~60 files **total** (CS-12) | "concise" |
| Picks **Walkthrough** + entryPoint | `{ kind, entryPoint }` | "Trace this entry point as one journey; keep unrelated areas brief" | ~40 files **total**, entry-point-centered (CS-12) | narrative |
| (No mode — direct API call) | `mode` undefined | `modeDirective` block omitted entirely | unbounded | unbounded |
| Triage `subsystems[].importance` | report → modal default selection | Top-3 by importance preselected ([TriageModal.tsx:30-33](../apps/player/src/pipeline/TriageModal.tsx#L30-L33)) | indirect | — |
| Triage `entryPoints[0]` | report → walkthrough default | First entry point preselected ([TriageModal.tsx:41-43](../apps/player/src/pipeline/TriageModal.tsx#L41-L43)) | indirect | — |
| Triage `totalFiles > 300` | report → modal default mode | Defaults selector to `focused-brief` ([TriageModal.tsx:24-25](../apps/player/src/pipeline/TriageModal.tsx#L24-L25)) | indirect | — |

---

## 4. Inconsistencies in depth & focus (current)

These are the items to break down into Jira tickets.

1. ~~**File budgets are asymmetric across modes.**~~ **Resolved by CS-12.** Every mode now declares an explicit budget via `MODE_BUDGETS` in [render-prompt.ts](../apps/server/lib/agents/render-prompt.ts): overview 30, scorecard 60, walkthrough 40, focused-brief 15–50/subsystem.
2. ~~**Prose-style depth lever exists only for `focused-brief`.**~~ **Partly resolved by CS-12** — every mode now carries a `depth` value in the trace (0.3 / 0.3 / 0.4 / 0.5). User-facing depth sliders for overview/scorecard/walkthrough remain deferred.
3. **`maxExecuteTokens` is mode-blind.** Tracked as CS-3. Both 1a and 1b inherit a static 32k from gnome definition — even though 1a's prompt says 4k. The platform doesn't enforce the prompt-side claim.
4. ~~**Triage's "3-8 subsystems" doesn't bound the user's pick.**~~ **Resolved by CS-12.** `focused-brief` now server-side clamps `subsystems[]` to the top `MAX_FOCUSED_SUBSYSTEMS` (5) by importance; dropped names flow into the trace as `clampedSubsystems`.
5. **`focusAreas` / `priorityPaths` overlap with `mode`.** Both are still in the request schema and still inject prompt text, but `focused-brief.subsystems` and `walkthrough.entryPoint` largely supersede them. No documented precedence.
6. ~~**Default `depth = 0.3` lives in two places** — [TriageModal.tsx:38](../apps/player/src/pipeline/TriageModal.tsx#L38) and [analyze/route.ts:23](../apps/server/app/api/analyze/route.ts#L23). The modal comment warns "keep these in lockstep" — easy footgun.~~ **Resolved by CS-13.** Both sites now import `DEFAULT_DEPTH` from [packages/shared-types/src/constants.ts](../packages/shared-types/src/constants.ts).
7. ~~**`totalFiles > 300` as the modal's auto-default for `focused-brief`** but the gnome prompt says `500+`. Two different "this repo is large" thresholds.~~ **Resolved by CS-13.** Unified on `LARGE_REPO_FILE_THRESHOLD = 300` from the shared constants module; the gnome prompt now interpolates the same value.
8. **Naming drift.** ARCHITECTURE.md still uses "deep dive" in places. The doc itself acknowledges the rename to `focused-brief` at line 801, but earlier sections (Phase 4, settings tables) don't reflect it.

### Suggested ticket groupings

- **Group A — Budget parity across modes** (items 1, 2, 4): give every mode an explicit file-budget + depth lever; cap `subsystems.length` for focused-brief.
- **Group B — Single source of truth for thresholds** (items 6, 7): centralize `depth` defaults and "large repo" thresholds in one shared module.
- **Group C — Request-shape cleanup** (item 5): decide if `focusAreas`/`priorityPaths` are deprecated by `mode`, or define explicit precedence + document it.
- **Group D — Platform / runtime levers** (item 3, CS-3): thread mode-aware `maxExecuteTokens` through the active session layer.
- **Group E — Documentation** (item 8): pass through ARCHITECTURE.md to retire "deep dive" wording outside the explicit "name reserved for future" callout.

---

## 5. Observable view: `traceMode` on every analysis run

To compare runs and tune, each `Analysis` row carries a `tunables` JSON column populated by [traceMode()](../apps/server/lib/agents/trace-mode.ts). Captured fields:

| Stage | Field |
|---|---|
| 1a output | `totalFiles`, `subsystems[].name+importance`, `entryPoints[].file` |
| User pick | `mode.kind`, `mode.subsystems[]` (focused-brief), `mode.depth`, `mode.entryPoint` (walkthrough) |
| Derived 1b budget | `effectiveBudget` — numeric for every mode post-CS-12 (overview 30, scorecard 60, walkthrough 40, focused-brief `(15 + depth*35) × subsystems.length`) |
| Derived 1b prose band | brief / bullets / detailed (focused-brief only) |
| Focused-brief clamp | `clampedSubsystems[]` — names dropped by `MAX_FOCUSED_SUBSYSTEMS` (5) |
| Static caps still in play | `largeRepoCutoff: 500`, `maxExecuteTokens: 32000` |

Inspect via `psql` or pgAdmin; the column is `Analysis.tunables`.
