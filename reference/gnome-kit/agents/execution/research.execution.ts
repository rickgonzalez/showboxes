// Research Gnome — Hybrid Execution Override
//
// Uses Anthropic's native server-side web_search and web_fetch tools
// so Claude can search the web and fetch pages directly during execution.
// Falls back to pre-fetching via Browserless when URLs are known upfront.
//
// Strategy:
//   1. Extract any explicit URLs from the plan/task/knowledge base
//   2. Pre-fetch known URLs via Browserless (parallel, fast)
//   3. Give Claude the pre-fetched content PLUS web_search + web_fetch tools
//   4. Claude can search for additional info and fetch pages it discovers
//   5. Claude produces the trend brief via submit_work_product
//
// This combines the efficiency of pre-fetching with the flexibility of
// live search — Claude isn't limited to just the URLs in the plan.

import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolUseBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type {
  AgentDefinition,
  AgentContext,
  ExecutionPlan,
  ExecutionResult,
  StepResult,
} from "../types";
import { fetchAllAndExtract } from "@/services/html-extract.service";
import { getAnthropicClient } from "@/services/agent.service";

// ── URL Extraction ───────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s"'<>)\]},]+/g;

function extractUrlsFromPlan(
  plan: ExecutionPlan,
  task: { title?: string; description?: string | null },
): Array<{ url: string }> {
  const seen = new Set<string>();
  const urls: Array<{ url: string }> = [];

  function collect(text: string) {
    const matches = text.match(URL_REGEX) || [];
    for (const url of matches) {
      const cleaned = url.replace(/[.,;:!?)]+$/, "");
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        urls.push({ url: cleaned });
      }
    }
  }

  for (const step of plan.steps) {
    collect(step.description);
    if (step.action) collect(step.action);
  }
  if (plan.summary) collect(plan.summary);
  if (task.title) collect(task.title);
  if (task.description) collect(task.description);

  return urls;
}

// ── URL Normalization ────────────────────────────────────

/**
 * Rewrite URLs to more fetch-friendly versions:
 * - Reddit → old.reddit.com (server-rendered, no JS needed)
 */
function normalizeUrl(url: string): string {
  // Reddit: use old.reddit.com for server-rendered content
  if (/^https?:\/\/(www\.)?reddit\.com/.test(url)) {
    return url.replace(/^https?:\/\/(www\.)?reddit\.com/, "https://old.reddit.com");
  }
  return url;
}

// ── Single-Shot Execution with Web Search ────────────────

const MAX_TURNS = 5; // More turns now that Claude can search interactively

export async function researchExecuteOverride(
  agentDef: AgentDefinition,
  context: AgentContext,
  plan: ExecutionPlan,
  organizationId: string,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const steps: StepResult[] = [];

  console.log(`[research-override] Starting hybrid execution (pre-fetch + web search)`);

  // ── 1. Extract URLs from plan, task, and knowledge base ──
  const urls = extractUrlsFromPlan(plan, context.task);

  if (context.knowledgeBlock) {
    const knowledgeMatches = context.knowledgeBlock.match(URL_REGEX) || [];
    const seen = new Set(urls.map(u => u.url));
    for (const match of knowledgeMatches) {
      const cleaned = match.replace(/[.,;:!?)]+$/, "");
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        urls.push({ url: cleaned });
      }
    }
  }

  // Normalize URLs (e.g. reddit.com → old.reddit.com)
  const normalizedUrls = urls.map(u => ({ url: normalizeUrl(u.url) }));

  console.log(`[research-override] Extracted ${normalizedUrls.length} URLs:`, normalizedUrls.map(u => u.url));

  // ── 2. Pre-fetch known URLs via Browserless (best-effort) ──
  let contentBlock = "";
  let failedBlock = "";

  if (normalizedUrls.length > 0) {
    console.log(`[research-override] Pre-fetching ${normalizedUrls.length} pages via browserless...`);
    const fetchStart = Date.now();
    const pages = await fetchAllAndExtract(normalizedUrls);
    const fetchDurationMs = Date.now() - fetchStart;

    const fetchedPages = pages.filter((p) => p.fetchStatus === "FETCHED" && p.text.length > 100);
    const failedPages = pages.filter((p) => p.fetchStatus === "FAILED" || p.text.length <= 100);

    console.log(`[research-override] Fetches complete in ${fetchDurationMs}ms — ${fetchedPages.length} useful, ${failedPages.length} failed/empty`);

    // Record fetch steps for telemetry
    for (const page of pages) {
      steps.push({
        stepIndex: steps.length,
        type: "DATA_FETCH",
        action: "prefetch_page",
        description: `Pre-fetched ${page.url}`,
        tool: "fetch_page_content",
        toolInput: { url: page.url },
        toolOutput: {
          status: page.fetchStatus,
          textLength: page.text.length,
          originalHtmlLength: page.originalLength,
          title: page.title,
          ...(page.error ? { error: page.error } : {}),
        },
        status: page.fetchStatus === "FETCHED" && page.text.length > 100 ? "COMPLETED" : "FAILED",
        error: page.error,
        durationMs: fetchDurationMs,
      });
    }

    contentBlock = fetchedPages
      .map((p) => `### Source: ${p.title || p.url}\nURL: ${p.url}\n\n${p.text}`)
      .join("\n\n---\n\n");

    failedBlock = failedPages.length > 0
      ? `\n\n## Sources That Failed to Fetch (use web_search to find this information instead)\n${failedPages.map((p) => `- ${p.url}: ${p.error || "empty/minimal content"}`).join("\n")}`
      : "";
  }

  // ── 3. Build revision context ──
  const revisionContext = context.previousWorkProduct
    ? `\n\n## Revision Context
You are revising a previous version (v${context.previousWorkProduct.version}) of this work product.

Reviewer feedback: ${context.previousWorkProduct.reviewerNotes}
${context.previousWorkProduct.reviewerEdits ? `Reviewer edits: ${JSON.stringify(context.previousWorkProduct.reviewerEdits, null, 2)}` : ""}

Previous version data:
${JSON.stringify(context.previousWorkProduct.data, null, 2)}

Address the reviewer's feedback while preserving what worked in the previous version.`
    : "";

  // ── 4. Build prompt ──
  const hasPreFetchedContent = contentBlock.length > 0;

  const singleShotPrompt = `You are executing a research monitoring task.${hasPreFetchedContent ? " Some web sources have been pre-fetched for you below." : ""}

## Task
${context.task.title}
${context.task.description || ""}

## Plan
${plan.summary}
${hasPreFetchedContent ? `
## Pre-Fetched Source Content

${contentBlock}` : ""}${failedBlock}${revisionContext}

## Available Tools
- **web_search**: Search the web for current information. Use this to find articles, data, discussions, and news relevant to the research task. You can make multiple searches with different queries.
- **submit_work_product**: Submit your structured trend brief when your research is complete.

## Instructions
1. Review any pre-fetched content above for relevant signals and data.
2. Use web_search to find additional information, especially for:
   - Sources that failed to fetch (listed above)
   - Topics mentioned in the task that need current data
   - Competitor activity, industry trends, or market data
3. Synthesize ALL findings (pre-fetched + searched) into a trend brief.
4. You MUST call submit_work_product exactly once with your structured findings.

IMPORTANT: You must ALWAYS produce a trend brief, even if some sources failed or returned limited data. Use your search capabilities and knowledge to fill gaps. A partial brief with real signals is far better than no brief at all. Focus on quality over quantity — 2 actionable signals beat 10 vague observations.`;

  // ── 5. Build tools — web_search + web_fetch + submit_work_product ──
  // Use Anthropic's native server-side tools for web access
  const tools: (Anthropic.Tool | Anthropic.WebSearchTool20250305)[] = [];

  // Add Anthropic's native web search tool
  tools.push({
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 8,
  } as Anthropic.WebSearchTool20250305);

  // Add submit_work_product for the trend brief
  if (context.targetWorkProductSchema) {
    tools.push({
      name: "submit_work_product",
      description:
        "Submit the final structured trend brief for review. You MUST call this tool " +
        "exactly once with the deliverable content — signals, sources, and analysis.",
      input_schema:
        context.targetWorkProductSchema as Anthropic.Tool["input_schema"],
    });
  }

  // ── 6. LLM call (multi-turn for search interaction) ──
  console.log(`[research-override] Building prompt (${contentBlock.length} chars of pre-fetched content)`);
  console.log(`[research-override] Tools: web_search + submit_work_product`);
  const client = await getAnthropicClient(organizationId);
  console.log(`[research-override] Client ready — calling Claude (model: ${agentDef.defaultModel}, max_tokens: ${agentDef.maxExecuteTokens})`);

  const messages: MessageParam[] = [
    { role: "user", content: singleShotPrompt },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;
  let finalText = "";
  let capturedWorkProduct: Record<string, unknown> | undefined;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`[research-override] LLM turn ${turn + 1}/${MAX_TURNS}...`);
    const turnStart = Date.now();
    const response = await client.messages.create({
      model: agentDef.defaultModel,
      max_tokens: agentDef.maxExecuteTokens,
      system: agentDef.buildSystemPrompt(context),
      tools: tools as Anthropic.Messages.Tool[],
      messages,
    });
    console.log(`[research-override] LLM turn ${turn + 1} complete in ${Date.now() - turnStart}ms — stop_reason: ${response.stop_reason}, input: ${response.usage.input_tokens}, output: ${response.usage.output_tokens}`);

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Collect text
    const textBlocks = response.content
      .filter(
        (b): b is Extract<(typeof response.content)[number], { type: "text" }> =>
          b.type === "text",
      )
      .map((b) => b.text);

    if (textBlocks.length > 0) {
      finalText = textBlocks.join("\n");
    }

    // Check for tool use
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    // Handle submit_work_product
    const submitCall = toolUseBlocks.find(
      (b) => b.name === "submit_work_product",
    );
    if (submitCall) {
      console.log(`[research-override] submit_work_product called — capturing work product`);
      capturedWorkProduct = submitCall.input as Record<string, unknown>;
      toolCallCount++;

      steps.push({
        stepIndex: steps.length,
        type: "WORK_PRODUCT_CREATED",
        action: "submit_work_product",
        description: "Submitted structured trend brief for review",
        tool: "submit_work_product",
        toolInput: capturedWorkProduct,
        toolOutput: { accepted: true },
        status: "COMPLETED",
        durationMs: Date.now() - startTime,
      });

      if (finalText) {
        steps.push({
          stepIndex: steps.length,
          type: "REPORT",
          action: "analysis_summary",
          description: "Research analysis and summary",
          llmResponse: finalText,
          status: "COMPLETED",
          durationMs: Date.now() - startTime,
        });
      }

      break; // Done — work product captured
    }

    // web_search results are handled automatically by the API as server tools —
    // they appear as web_search_tool_result blocks in the response, and we just
    // need to continue the conversation. Record search steps for telemetry.
    const searchSteps = response.content.filter(
      (b) => b.type === "web_search_tool_result" as string,
    );
    for (const searchStep of searchSteps) {
      toolCallCount++;
      steps.push({
        stepIndex: steps.length,
        type: "DATA_FETCH",
        action: "web_search",
        description: "Performed web search",
        tool: "web_search",
        status: "COMPLETED",
        durationMs: Date.now() - turnStart,
      });
    }

    // If stop_reason is "end_turn" and no tool calls, Claude is done
    if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
      if (turn < MAX_TURNS - 1 && !capturedWorkProduct && tools.length > 0) {
        // Safety net: Claude finished without calling submit_work_product.
        // Ask it to call the tool.
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content:
            "Your analysis is complete. Now you MUST call the submit_work_product tool with your structured findings. Do not include any additional text — just call the tool.",
        });
        continue;
      }

      // Record final text
      if (finalText) {
        steps.push({
          stepIndex: steps.length,
          type: "REPORT",
          action: "final_summary",
          description: "Compiled final report",
          llmResponse: finalText,
          status: "COMPLETED",
          durationMs: Date.now() - startTime,
        });
      }
      break;
    }

    // If stop_reason is "tool_use", continue the loop — the API will handle
    // web_search results automatically in the next turn.
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      // For non-server tools (submit_work_product was already handled above),
      // return tool results. Server tools (web_search) are handled by the API.
      const nonServerToolCalls = toolUseBlocks.filter(
        (b) => b.name !== "web_search" && b.name !== "submit_work_product",
      );
      if (nonServerToolCalls.length > 0) {
        const toolResults: ToolResultBlockParam[] = nonServerToolCalls.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: `Tool "${tu.name}" is not available. Use web_search or submit_work_product.`,
          is_error: true,
        }));
        messages.push({ role: "user", content: toolResults });
      }
      continue;
    }
  }

  // ── 7. Return standard ExecutionResult ──
  const durationMs = Date.now() - startTime;
  const success = !!capturedWorkProduct || steps.some((s) => s.type === "REPORT" && s.status === "COMPLETED");
  console.log(`[research-override] Complete in ${durationMs}ms — tokens: ${totalInputTokens} in / ${totalOutputTokens} out, tool calls: ${toolCallCount}, work product: ${!!capturedWorkProduct}`);

  return {
    success,
    output: {
      summary: finalText.slice(0, 500),
      stepsCompleted: steps.filter((s) => s.status === "COMPLETED").length,
      stepsFailed: steps.filter((s) => s.status === "FAILED").length,
    },
    outputText: finalText,
    steps,
    telemetry: {
      model: agentDef.defaultModel,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      durationMs,
      toolCalls: toolCallCount,
    },
    workProductData: capturedWorkProduct,
  };
}
