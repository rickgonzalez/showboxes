/**
 * Phase 5 — Platform tool registry for the Managed Agents path.
 *
 * Module-scoped `Map<string, PlatformTool>` keyed by tool name (NOT by
 * provider type — names are the lookup key during dispatch). Each
 * `providers/*.ts` file calls `registerPlatformTool` at module load time;
 * `index.ts` imports them all for side effects so a single
 * `import "./platform-tools"` populates the registry.
 *
 * Two consumers:
 *   - `sync.ts → buildAgentBody` calls `getAllToolsForProviders(gnome.toolProviders)`
 *     to assemble the `tools[]` array on the remote Managed Agent.
 *   - `agent.session.service.ts → dispatchPlatformToolCall` calls
 *     `getPlatformToolByName(name)` when an `agent.custom_tool_use` event
 *     names something other than the two human-gated reserved names.
 *
 * Both must agree on the same set of tools — that's why both go through this
 * single registry instead of e.g. `buildAgentBody` enumerating providers and
 * dispatcher pattern-matching independently.
 */

import type { ToolProviderType } from "@/agents/types";
import type { PlatformTool } from "./types";

const tools = new Map<string, PlatformTool>();

/**
 * Register a tool with the platform-tools registry. Called once per tool at
 * module load time from each `providers/*.ts`. Throws on duplicate names so a
 * collision crashes the process at startup rather than silently overwriting.
 */
export function registerPlatformTool(tool: PlatformTool): void {
  if (tools.has(tool.name)) {
    throw new Error(
      `[platform-tools] duplicate tool name "${tool.name}" — ` +
        `each tool must have a globally unique name across all providers.`,
    );
  }
  tools.set(tool.name, tool);
}

/**
 * Lookup by name. Used by the dispatcher when an `agent.custom_tool_use`
 * event arrives. Returns `undefined` for unknown names — the caller is
 * expected to resolve the call with `{ error: "unknown_tool" }, isError: true`
 * so the agent gets a clean failure rather than a stuck session.
 */
export function getPlatformToolByName(name: string): PlatformTool | undefined {
  return tools.get(name);
}

/**
 * Filter the registry by provider list. Returns the union of all tools whose
 * `provider` field appears in `providers`. Order is registration order
 * (insertion order on the underlying Map), which keeps the
 * `buildAgentBody → tools[]` array stable across syncs. Stability matters
 * because the seed script will version-bump every gnome on each run otherwise.
 */
export function getAllToolsForProviders(
  providers: ToolProviderType[],
): PlatformTool[] {
  if (providers.length === 0) return [];
  const wanted = new Set(providers);
  const out: PlatformTool[] = [];
  for (const tool of tools.values()) {
    if (wanted.has(tool.provider)) out.push(tool);
  }
  return out;
}

/**
 * Test-only escape hatch — returns every registered tool. Used by
 * `registry.test.ts` to walk the full tool set for schema validation. Not
 * exported from the public `index.ts`.
 */
export function _getAllPlatformToolsForTest(): PlatformTool[] {
  return Array.from(tools.values());
}
