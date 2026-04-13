/**
 * Twitter / X provider — stubs ported from `agents/tools/registry.ts:1020-1061`.
 *
 * Both tools return the legacy `{ note: "... integration pending" }` shape so
 * the managed and legacy paths produce identical observable behavior until a
 * real Twitter API v2 client lands. The stubs still receive credentials via
 * `ctx.credentials` so a future real implementation only needs to swap the
 * body, not the registration.
 */

import { registerPlatformTool } from "../registry";

registerPlatformTool({
  name: "twitter_get_metrics",
  description:
    "Fetch current Twitter/X metrics for the connected account (followers, impressions, engagements, top tweets).",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "string",
          enum: ["followers", "impressions", "engagements", "tweets", "mentions"],
        },
      },
      period: { type: "string", enum: ["today", "7d", "28d"] },
    },
    required: ["metrics"],
  },
  requiredSources: ["TWITTER"],
  hasSideEffects: false,
  provider: "twitter",
  execute: async (input, ctx) => {
    return {
      type: "twitter_metrics",
      account: ctx.credentialsMeta?.accountHandle ?? null,
      period: input.period,
      note: "Twitter API integration pending",
    };
  },
});

registerPlatformTool({
  name: "twitter_post",
  description:
    "Post a tweet to the connected Twitter/X account. REQUIRES APPROVAL.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Tweet text (max 280 characters)" },
      media_urls: {
        type: "array",
        items: { type: "string" },
        description: "Optional media URLs to attach",
      },
    },
    required: ["text"],
  },
  requiredSources: ["TWITTER"],
  hasSideEffects: true,
  provider: "twitter",
  execute: async (input) => {
    return {
      type: "twitter_post",
      text: input.text,
      note: "Twitter posting integration pending",
    };
  },
});
