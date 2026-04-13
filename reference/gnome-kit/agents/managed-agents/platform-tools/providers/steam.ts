/**
 * Steam provider — stub ported from `agents/tools/registry.ts:1063-1084`.
 * Returns the legacy `{ note: "... integration pending" }` shape until a real
 * Steam Web API client lands.
 */

import { registerPlatformTool } from "../registry";

registerPlatformTool({
  name: "steam_get_metrics",
  description:
    "Fetch Steam store metrics (wishlists, page visits, reviews, player counts).",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "wishlists",
            "page_visits",
            "reviews",
            "players_current",
            "players_peak",
          ],
        },
      },
    },
    required: ["metrics"],
  },
  requiredSources: ["STEAM"],
  hasSideEffects: false,
  provider: "steam",
  execute: async (_input, ctx) => {
    return {
      type: "steam_metrics",
      appId: (ctx.credentials as { appId?: string } | undefined)?.appId ?? null,
      note: "Steam API integration pending",
    };
  },
});
