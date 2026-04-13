/**
 * Instagram provider — stub ported from `agents/tools/registry.ts:1152-1174`.
 */

import { registerPlatformTool } from "../registry";

registerPlatformTool({
  name: "instagram_get_metrics",
  description:
    "Fetch Instagram metrics (followers, reach, impressions, engagement rate, top posts).",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "followers",
            "reach",
            "impressions",
            "engagement_rate",
            "top_posts",
          ],
        },
      },
      period: { type: "string", enum: ["today", "7d", "28d"] },
    },
    required: ["metrics"],
  },
  requiredSources: ["INSTAGRAM"],
  hasSideEffects: false,
  provider: "instagram",
  execute: async (_input, ctx) => {
    return {
      type: "instagram_metrics",
      account: ctx.credentialsMeta?.accountHandle ?? null,
      note: "Instagram API integration pending",
    };
  },
});
