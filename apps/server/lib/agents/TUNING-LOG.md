# Prompt Tuning Log

Track prompt changes, timing observations, and their effects here. Each entry correlates a change to a specific file/location with observed behavior before and after.

---

## How to Use This Log

1. **Watch a run** — note timing, quality, or behavior issues
2. **Add an entry below** — describe what you saw, what you changed, and what happened
3. **Tag the area** so entries are filterable: `[agent-1a]` `[agent-1b]` `[producer]` `[mode-directive]` `[template]`
4. **Reference the Jira ticket** if one exists (e.g. `CS-12`)

### File Quick Reference

| Tag | File | What it controls |
|-----|------|-----------------|
| `[agent-1a]` | `code-triage.gnome.ts` | Triage pass (Haiku) — tree + manifests only, ~30s |
| `[agent-1b]` | `code-analysis.gnome.ts` | Full analysis (Sonnet) — five-section structured output |
| `[mode-directive]` | `render-prompt.ts` → `renderModeDirective()` | Steers depth/breadth per mode (overview, focused-brief, scorecard, walkthrough) |
| `[producer]` | `producer.system-prompt.ts` | Static system prompt — creative principles, primitive catalog, constraints |
| `[producer-msg]` | `producer.message.ts` | User message assembly — settings hints, analysis JSON, focus instructions |
| `[template]` | `../../player/src/templates/` | Visual primitive implementations |

---

## Entries

### 2026-04-13 — Rename `deep-dive` → `focused-brief`, add depth lever

**Area:** `[mode-directive]` `[agent-1b]`
**Jira:** CS-6
**Change:** Renamed the scoped-subsystem mode from `deep-dive` to `focused-brief` and added a `depth: number` (0–1, default 0.3) lever on that variant. The name "deep dive" is reserved for a future exhaustive code-level mode. The directive now computes a per-subsystem file budget as `Math.round(15 + depth * 35)` (15 @ 0, ~32 @ 0.5, 50 @ 1) and picks one of three prose bands: concise paragraph / bulleted findings / detailed findings with citations.

**Why:** Previous `deep-dive` had no file cap and explicitly encouraged "detailed findings," so a scoped run consistently filled the 32k output budget and ran longer than the capped 30-file overview. A single continuous lever lets the user trade breadth for thoroughness without adding more modes.

**Touched:** `render-prompt.ts` (directive body), `triage.ts` (union + new `depth` field), `route.ts` (Zod schema + default coercion), `TriageModal.tsx` (copy + slider), `index.css` (`sb-modal-slider`).

**Deferred to CS-3:** `maxExecuteTokens` is still a static 32k per gnome definition and is not yet mode-aware. This change constrains via prompt only.

**Status:** Landed. Verify with a focused-brief run on a mid-size repo and compare wall-clock against overview at default depth.

---

### 2026-04-13 — Known issue: deep-dive runs longer than overview

**Area:** `[mode-directive]` `[agent-1b]`
**Jira:** CS-6 (parent), CS-1 (file budget), CS-2 (tighten brief coverage), CS-3 (maxExecuteTokens)
**Observed:** Deep-dive on 2 subsystems runs longer than a full overview — inverse of expected behavior from a scoped mode.

**Root cause (suspected):**
- Overview has a hard ~30-file cap in `renderModeDirective()`
- Deep-dive has NO file cap — agent traces imports across subsystem boundaries (auth → db, config, middleware, shared utils)
- The prompt actively encourages "detailed findings" which fills the 32k output budget

**Planned tweaks (from architecture.md):**
1. Soft file budget per deep-dive subsystem (~40 files), with guidance to prefer files the subsystem owns outright over imported utilities
2. Tighter "cover other areas briefly" instruction so the non-focused portion doesn't quietly expand
3. Consider a lower `maxExecuteTokens` for deep-dive than for full analysis

**Location:** All three tweaks are localized to `renderModeDirective()` in `render-prompt.ts` — no schema or UI changes needed.

**Status:** Addressed by CS-6 (see entry above). File budget and prose banding landed via the new `depth` lever; `maxExecuteTokens` still pending on CS-3.

---

### 2026-04-13 — Baseline: current mode directive text

**Area:** `[mode-directive]`
**Snapshot for diffing against future changes:**

```
overview: "Produce a HIGH-LEVEL OVERVIEW. Cap your exploration to ~30 files total..."
deep-dive: "DEEP DIVE on: {subsystems}. Spend most of your exploration budget inside these subsystems..."
scorecard: "Produce a SCORECARD-STYLE analysis. Prioritize codeQuality and health..."
walkthrough: "GUIDED WALKTHROUGH centered on entry point: {entryPoint}..."
```

None of these currently specify file budgets except overview (~30 files).

---

<!-- 
TEMPLATE — copy this for new entries:

### YYYY-MM-DD — Short description

**Area:** `[tag]`
**Jira:** CS-XX
**Observed:** What you saw (timing, quality, behavior)
**Before:** What the prompt/config said before the change
**Change:** What you changed and why
**After:** What happened — better/worse/same? Include timing if relevant.
**Status:** Attempted / Reverted / Kept / Needs more testing
-->
