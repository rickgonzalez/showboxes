/**
 * Phase 5 — registry sanity check.
 *
 * marymary doesn't ship a unit-test framework (no vitest/jest in
 * package.json), so this is a tsx-runnable assertion script. Exits 1 on any
 * failure so it can be wired into CI later. Run with:
 *
 *     npx tsx src/agents/managed-agents/platform-tools/registry.test.ts
 *
 * Three checks:
 *
 * 1. Every registered tool's `inputSchema` MUST NOT contain
 *    `additionalProperties` at any depth. The Managed Agents beta rejects
 *    custom-tool input schemas that declare it (see the same gotcha in
 *    EXECUTION_PLAN_JSON_SCHEMA / WORK_PRODUCT_SUBMISSION_JSON_SCHEMA in
 *    `src/agents/types.ts`). Catching this locally prevents an ugly 400 from
 *    the seed script.
 *
 * 2. No tool name collides with the reserved Phase 3/4 custom tools
 *    (`marymary_submit_plan`, `marymary_submit_work_product`).
 *
 * 3. Tool names are globally unique. The registry's `registerPlatformTool`
 *    already enforces this at module load — this is a defense-in-depth
 *    re-check after every provider has had a chance to register.
 */

import "./index";
import { _getAllPlatformToolsForTest } from "./registry";
import {
  SUBMIT_PLAN_TOOL_NAME,
  SUBMIT_WORK_PRODUCT_TOOL_NAME,
} from "../sync";

let failed = 0;

function fail(msg: string) {
  console.error(`  ✗ ${msg}`);
  failed++;
}

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}

/**
 * Walks the JSON-Schema tree looking for `additionalProperties`. Returns the
 * dot-path of the first occurrence (or null). Recurses into `properties`,
 * `items`, `oneOf`, `anyOf`, `allOf`, and arbitrary nested objects so it
 * catches the field no matter how deeply it's buried.
 */
function findAdditionalPropertiesPath(
  schema: unknown,
  path = "",
): string | null {
  if (!schema || typeof schema !== "object") return null;
  const obj = schema as Record<string, unknown>;
  if ("additionalProperties" in obj) {
    return `${path || "<root>"}.additionalProperties`;
  }
  for (const [key, value] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const found = findAdditionalPropertiesPath(value[i], `${childPath}[${i}]`);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findAdditionalPropertiesPath(value, childPath);
      if (found) return found;
    }
  }
  return null;
}

const tools = _getAllPlatformToolsForTest();

console.log(`\n[platform-tools registry test] ${tools.length} tools registered\n`);

if (tools.length === 0) {
  fail("registry is empty — did the side-effect imports run?");
}

// Check 1: no additionalProperties anywhere
console.log("[1] inputSchema does not declare additionalProperties");
for (const tool of tools) {
  const found = findAdditionalPropertiesPath(tool.inputSchema);
  if (found) {
    fail(`tool "${tool.name}" has additionalProperties at ${found}`);
  } else {
    pass(`${tool.name}`);
  }
}

// Check 2: no collision with reserved names
console.log("\n[2] no collision with reserved custom tool names");
const reserved = new Set([SUBMIT_PLAN_TOOL_NAME, SUBMIT_WORK_PRODUCT_TOOL_NAME]);
for (const tool of tools) {
  if (reserved.has(tool.name)) {
    fail(`tool "${tool.name}" collides with reserved custom tool name`);
  }
}
if (tools.every((t) => !reserved.has(t.name))) {
  pass("no collisions");
}

// Check 3: globally unique names
console.log("\n[3] tool names are globally unique");
const seen = new Map<string, number>();
for (const tool of tools) {
  seen.set(tool.name, (seen.get(tool.name) ?? 0) + 1);
}
const dupes = Array.from(seen.entries()).filter(([, count]) => count > 1);
if (dupes.length > 0) {
  for (const [name, count] of dupes) {
    fail(`tool "${name}" registered ${count} times`);
  }
} else {
  pass(`${seen.size} unique tool names`);
}

console.log("");
if (failed > 0) {
  console.error(`[platform-tools registry test] FAILED — ${failed} check(s) failed\n`);
  process.exit(1);
}
console.log("[platform-tools registry test] OK\n");
