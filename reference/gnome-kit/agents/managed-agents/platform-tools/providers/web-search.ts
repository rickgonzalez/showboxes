/**
 * web_search built-in — Phase 5 port from `agents/tools/registry.ts:129-285`.
 *
 * Three tools:
 *   - `web_search` — stub that the LLM resolves itself (search API integration
 *     was never wired up). Kept as a port-faithful copy so behavior matches the
 *     legacy path until a real Tavily/Serper integration lands.
 *   - `fetch_page_content` — real Browserless.io fetch via
 *     `screenshot.service.fetchPageContent`.
 *   - `extract_content` — LLM-resolved structuring helper. Like `web_search`,
 *     the call signals intent and the LLM does the parsing in its next turn.
 *
 * No credentials. Belongs to the `web_search` provider so any gnome that
 * declares `web_search` in `toolProviders` gets all three.
 */

import { registerPlatformTool } from "../registry";

const MAX_CONTENT_LENGTH = 100_000;

registerPlatformTool({
  name: "web_search",
  description:
    "Search the web for information relevant to the task. Use for competitor " +
    "analysis, trend research, or finding opportunities.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      num_results: {
        type: "number",
        description: "Number of results to return (max 10)",
      },
    },
    required: ["query"],
  },
  requiredSources: [],
  hasSideEffects: false,
  provider: "web_search",
  execute: async (input) => {
    return {
      type: "web_search",
      query: input.query,
      note: "Web search integration pending",
    };
  },
});

registerPlatformTool({
  name: "fetch_page_content",
  description:
    "Fetch the fully-rendered HTML content of a web page using headless Chrome (via Browserless.io). " +
    "Returns the page's rendered DOM — use this instead of raw HTTP requests to handle JavaScript-rendered " +
    "sites like Reddit, Hacker News, forums, and SPAs. Essential for monitoring sources and extracting " +
    "content from dynamic pages. The returned HTML can then be parsed to extract articles, discussions, " +
    "comments, upvote counts, and other structured content.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL to fetch (e.g. 'https://news.ycombinator.com', 'https://www.reddit.com/r/fintech/hot').",
      },
      waitForSelector: {
        type: "string",
        description:
          "Optional CSS selector to wait for before returning content. " +
          "Use when the page loads content dynamically (e.g. '.Post' for Reddit, '.athing' for HN).",
      },
      waitUntil: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
        description:
          "When to consider the page loaded. Default: 'networkidle2' (recommended for most sites).",
      },
    },
    required: ["url"],
  },
  requiredSources: [],
  hasSideEffects: false,
  provider: "web_search",
  execute: async (input) => {
    const { fetchPageContent, isConfigured } = await import(
      "@/services/screenshot.service"
    );

    if (!isConfigured()) {
      return {
        error: true,
        message:
          "Browserless.io is not configured. Set BROWSERLESS_API_KEY to enable page content fetching.",
      };
    }

    try {
      const result = await fetchPageContent(input.url as string, {
        waitForSelector: (input.waitForSelector as string) ?? undefined,
        waitUntil:
          (input.waitUntil as
            | "load"
            | "domcontentloaded"
            | "networkidle0"
            | "networkidle2") ?? undefined,
      });

      // Truncate very large pages to avoid blowing up context windows.
      // 100k chars is roughly 25k tokens — generous but bounded.
      const html =
        result.html.length > MAX_CONTENT_LENGTH
          ? result.html.slice(0, MAX_CONTENT_LENGTH) +
            "\n\n[... content truncated at 100k characters ...]"
          : result.html;

      return {
        url: result.url,
        contentLength: result.html.length,
        truncated: result.html.length > MAX_CONTENT_LENGTH,
        html,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: true,
        url: input.url,
        message: `Failed to fetch page content: ${message}`,
      };
    }
  },
});

registerPlatformTool({
  name: "extract_content",
  description:
    "Extract and structure content from raw HTML. Provide the HTML (from fetch_page_content) " +
    "and specify what to extract — the LLM will parse the HTML and return structured data. " +
    "Use this to turn a fetched page into actionable data: top discussions, trending topics, " +
    "comment sentiment, article summaries, etc.",
  inputSchema: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "The raw HTML content to extract from (from fetch_page_content result).",
      },
      sourceUrl: {
        type: "string",
        description: "The URL this HTML came from (for attribution).",
      },
      extractionGoal: {
        type: "string",
        description:
          "What to extract from the page. Be specific. Examples: " +
          "'top 10 posts by upvotes with titles, scores, and comment counts', " +
          "'all comments mentioning community banking or fintech', " +
          "'article headlines and summaries from the front page', " +
          "'user questions and complaints about banking software'.",
      },
      format: {
        type: "string",
        enum: ["list", "table", "summary", "signals"],
        description:
          "Output format. 'list' = array of items, 'table' = rows and columns, " +
          "'summary' = prose summary, 'signals' = pre-classified trend signals.",
      },
    },
    required: ["html", "extractionGoal"],
  },
  requiredSources: [],
  hasSideEffects: false,
  provider: "web_search",
  execute: async (input) => {
    return {
      type: "content_extraction",
      sourceUrl: input.sourceUrl,
      extractionGoal: input.extractionGoal,
      format: input.format ?? "signals",
      note: "Content extraction will be performed by the LLM in the next reasoning step.",
    };
  },
});
