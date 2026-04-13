/**
 * Discord provider — stubs ported from `agents/tools/registry.ts:1086-1125`.
 * Both tools return the legacy `{ note: "... integration pending" }` shape
 * until a real discord.js client lands.
 */

import { registerPlatformTool } from "../registry";

registerPlatformTool({
  name: "discord_get_metrics",
  description:
    "Fetch Discord server metrics (member count, active users, messages per day).",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "string",
          enum: ["members", "online", "messages_today", "new_members_7d"],
        },
      },
    },
    required: ["metrics"],
  },
  requiredSources: ["DISCORD"],
  hasSideEffects: false,
  provider: "discord",
  execute: async (_input, ctx) => {
    return {
      type: "discord_metrics",
      server: ctx.credentialsMeta?.serverName ?? null,
      note: "Discord API integration pending",
    };
  },
});

registerPlatformTool({
  name: "discord_post_message",
  description:
    "Post a message to a Discord channel. REQUIRES APPROVAL.",
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel name or ID" },
      content: { type: "string", description: "Message content" },
      embed: { type: "object", description: "Optional rich embed" },
    },
    required: ["channel", "content"],
  },
  requiredSources: ["DISCORD"],
  hasSideEffects: true,
  provider: "discord",
  execute: async (input) => {
    return {
      type: "discord_post",
      channel: input.channel,
      note: "Discord API integration pending",
    };
  },
});
