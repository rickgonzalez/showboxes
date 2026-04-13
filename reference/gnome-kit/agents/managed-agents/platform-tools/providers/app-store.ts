/**
 * App Store provider — stub ported from `agents/tools/registry.ts:1176-1198`.
 */

import { registerPlatformTool } from "../registry";

registerPlatformTool({
  name: "appstore_get_metrics",
  description:
    "Fetch App Store metrics (downloads, ratings, reviews, crashes).",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "string",
          enum: ["downloads", "ratings", "reviews", "crashes", "active_devices"],
        },
      },
      period: { type: "string", enum: ["7d", "28d", "90d"] },
    },
    required: ["metrics"],
  },
  requiredSources: ["APP_STORE_IOS"],
  hasSideEffects: false,
  provider: "app_store",
  execute: async (_input, ctx) => {
    return {
      type: "appstore_metrics",
      bundleId: ctx.credentialsMeta?.bundleId ?? null,
      note: "App Store Connect API integration pending",
    };
  },
});
