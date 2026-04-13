// Template engine for gnome system prompts.
// Converts AgentContext into a flat variable namespace and renders
// Handlebars templates. Complex conditional sections (metrics, tools,
// work products) are pre-rendered into string variables so users
// don't need to write logic in their templates.

import Handlebars from "handlebars";
import type { AgentContext } from "./types";

// Register a {{default}} helper for fallback values
Handlebars.registerHelper("default", function (value: unknown, fallback: string) {
  return value != null && value !== "" ? value : fallback;
});

/**
 * Flatten AgentContext into the variable namespace used by gnome templates.
 * All complex sections are pre-rendered into plain strings.
 */
export function flattenAgentContext(ctx: AgentContext): Record<string, unknown> {
  const project = ctx.tactic.project;

  // Pre-render metrics section
  const metricsSection =
    ctx.recentMetrics.length > 0
      ? ctx.recentMetrics
          .map(
            (m) =>
              `- ${m.source} ${m.metric}: ${m.value}${m.unit ? ` ${m.unit}` : ""} (${m.recordedAt.toISOString().split("T")[0]})`,
          )
          .join("\n")
      : "No metrics recorded yet.";

  // Pre-render tools section
  const toolsSection =
    ctx.availableTools.length > 0
      ? ctx.availableTools
          .map(
            (t) =>
              `- **${t.name}**: ${t.description}${t.hasSideEffects ? " ⚠️ HAS SIDE EFFECTS" : ""}`,
          )
          .join("\n")
      : "No tools available.";

  // Pre-render previous executions section
  const previousExecutionsSection =
    ctx.previousExecutions.length > 0
      ? `## Previous Attempts\n${ctx.previousExecutions.map((e) => `- [${e.status}] ${e.outputText ?? e.error ?? "no output"}`).join("\n")}`
      : "";

  // Pre-render work product section
  let workProductSection = "";
  if (ctx.targetWorkProductSchema) {
    workProductSection = `
## Work Product Delivery
This task MUST produce a structured work product. After completing your analysis, you MUST call the submit_work_product tool exactly once to deliver the final artifact.

Rules:
- The "body" field contains the actual post text — no markdown formatting, no headers, no labels, no analysis
- Hashtags go in the hashtags array WITHOUT the # symbol
- Use the project knowledge base to ensure content matches brand voice
- Do your analysis and reasoning in text, then call submit_work_product with ONLY the deliverable content`;

    if (ctx.previousWorkProduct) {
      workProductSection += `

### Revision Context
You are revising version ${ctx.previousWorkProduct.version}. The reviewer provided this feedback:
${ctx.previousWorkProduct.reviewerNotes}
${ctx.previousWorkProduct.reviewerEdits ? `\nReviewer edits: ${JSON.stringify(ctx.previousWorkProduct.reviewerEdits, null, 2)}` : ""}

Previous version:
${JSON.stringify(ctx.previousWorkProduct.data, null, 2)}

Address the feedback while preserving what worked.`;
    }
  } else {
    workProductSection =
      "Complete this task by using your available tools and providing a detailed report.";
  }

  // Pre-render source work product section (task bump context)
  let sourceWorkProductSection = "";
  if (ctx.sourceWorkProduct) {
    sourceWorkProductSection = `## Source Material
This task was created as a follow-on from "${ctx.sourceWorkProduct.sourceTaskTitle}" (${ctx.sourceWorkProduct.definitionSlug} v${ctx.sourceWorkProduct.version}).

Use the following work product as source material and context for your work:

${JSON.stringify(ctx.sourceWorkProduct.data, null, 2)}${ctx.sourceWorkProduct.agentNotes ? `\n\nOriginal agent notes: ${ctx.sourceWorkProduct.agentNotes}` : ""}`;
  }

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description || "No description",
      vitalityScore: project.vitalityScore,
    },
    tactic: {
      id: ctx.tactic.id,
      name: ctx.tactic.name,
      description: ctx.tactic.description || "No description",
      category: ctx.tactic.category,
      branchHealth: ctx.tactic.branchHealth,
    },
    task: {
      id: ctx.task.id,
      tacticId: ctx.task.tacticId,
      title: ctx.task.title,
      description: ctx.task.description || "",
    },
    execution: ctx.execution ?? null,
    metricsSection,
    toolsSection,
    knowledgeBlock:
      ctx.knowledgeBlock || "No project documents available yet.",
    workProductSection,
    previousExecutionsSection,
    sourceWorkProductSection,
  };
}

/**
 * Render a Handlebars template with the given AgentContext.
 * Templates use {{variable}} syntax — no HTML escaping (noEscape).
 */
export function renderPromptTemplate(
  template: string,
  context: AgentContext,
): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  const vars = flattenAgentContext(context);
  return compiled(vars);
}
