// Adapter: resolves a Gnome (DB or built-in) into an AgentDefinition
// for consumption by the execution engine. This is the bridge between
// the user-editable gnome data and the runtime agent interface.

import type { TacticCategory } from "@prisma/client";
import type { AgentDefinition } from "./types";
import { renderPromptTemplate } from "./template";
import { resolveGnomeForCategory, resolveGnomeBySlug, type EffectiveGnome } from "@/services/gnome.service";
import { getAgentDefinition } from "./definitions";
import type { ToolProviderType } from "./types";
import { researchExecuteOverride } from "./execution/research.execution";

// Research gnome needs URLs in its plan so the single-shot execution
// can pre-fetch them via Browserless before sending content to Claude.
const RESEARCH_PLAN_SUFFIX = `
IMPORTANT — Research-specific planning rules:
1. For EVERY monitoring/fetch step, you MUST include the full URL(s) you will fetch in the step description.
   Example: "Fetch https://news.ycombinator.com to scan for trending tech discussions"
   NOT: "Monitor Hacker News for trending topics"
2. Use real, complete URLs (https://...) — not placeholders or generic references.
3. Choose URLs that are relevant to the task and project. Good sources include:
   - Reddit subreddits (e.g. https://www.reddit.com/r/fintech/top/?t=week)
   - Hacker News (https://news.ycombinator.com)
   - Industry blogs, forums, and news sites
   - Competitor websites and social profiles
4. If the task description or project knowledge base mentions specific sources or URLs, include those.
5. Aim for 3-8 URLs — enough for good coverage, not so many that results are shallow.
6. The URLs will be fetched server-side BEFORE execution, so pick pages that contain useful content when rendered.`;

/**
 * Convert an EffectiveGnome into an AgentDefinition that the
 * execution engine (agent.service.ts) can consume directly.
 */
function gnomeToAgentDefinition(gnome: EffectiveGnome): AgentDefinition {
  return {
    id: gnome.slug,
    name: gnome.name,
    categories: gnome.categories,
    description: gnome.description,
    defaultModel: gnome.defaultModel,
    toolProviders: gnome.toolProviders as ToolProviderType[],
    maxPlanTokens: gnome.maxPlanTokens,
    maxExecuteTokens: gnome.maxExecuteTokens,
    canAutoExecute: gnome.canAutoExecute,
    producibleWorkProducts: gnome.producibleWorkProducts,
    buildSystemPrompt: (context) => renderPromptTemplate(gnome.systemPromptTemplate, context),
    planPromptSuffix: gnome.slug === "research-gnome" ? RESEARCH_PLAN_SUFFIX : undefined,
    executeOverride: gnome.slug === "research-gnome" ? researchExecuteOverride : undefined,
  };
}

/**
 * Resolve the agent definition for a given project + tactic category.
 * Tries gnome resolution first, falls back to hardcoded definitions.
 */
export async function resolveAgent(
  projectId: string,
  category: TacticCategory,
): Promise<AgentDefinition | undefined> {
  const gnome = await resolveGnomeForCategory(projectId, category);
  if (gnome) {
    return gnomeToAgentDefinition(gnome);
  }

  // Fallback to hardcoded definitions (safety net during migration)
  return getAgentDefinition(category);
}

/**
 * Resolve an agent definition by gnome slug, regardless of tactic category.
 * Used when a task has been explicitly assigned to a specific gnome
 * (e.g. "designer-gnome" spawned by the social-media gnome).
 * Falls back to category-based resolution if slug doesn't match.
 */
export async function resolveAgentBySlug(
  projectId: string,
  slug: string,
  fallbackCategory?: TacticCategory,
): Promise<AgentDefinition | undefined> {
  const gnome = await resolveGnomeBySlug(projectId, slug);
  if (gnome) {
    return gnomeToAgentDefinition(gnome);
  }

  // Fallback to category if slug-based resolution fails
  if (fallbackCategory) {
    return resolveAgent(projectId, fallbackCategory);
  }

  return undefined;
}
