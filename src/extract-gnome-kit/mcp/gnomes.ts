import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GnomeService } from "@/services";
import { handleToolCall } from "./index";
import { resolveAuth } from "../auth";
import { prisma } from "@/lib/prisma";

const TacticCategory = z.enum([
  "SOCIAL_MEDIA", "COMMUNITY", "STORE_PRESENCE", "CONTENT_MARKETING",
  "PAID_ADS", "PARTNERSHIPS", "SEO", "EMAIL", "EVENTS", "OTHER",
]);

export function registerGnomeTools(server: McpServer) {
  server.registerTool(
    "list_gnomes",
    {
      title: "List Gnomes",
      description:
        "List all gnomes (agent definitions) for a project, including virtual " +
        "built-in defaults. Gnomes define how agents behave — their system prompts, " +
        "tool access, model selection, and work product capabilities.",
      inputSchema: {
        projectSlug: z.string().describe("The project's slug (e.g. 'solostream')"),
      },
    },
    async (args) => {
      return handleToolCall(async () => {
        const project = await prisma.project.findFirst({ where: { slug: args.projectSlug } });
        if (!project) throw new Error("Project not found");
        return GnomeService.getEffectiveGnomes(project.id);
      });
    },
  );

  server.registerTool(
    "get_gnome",
    {
      title: "Get Gnome",
      description:
        "Get a single gnome by ID, including its full system prompt template.",
      inputSchema: {
        gnomeId: z.string().describe("The gnome's ID"),
      },
    },
    async (args) => {
      return handleToolCall(() => GnomeService.getGnome(args.gnomeId));
    },
  );

  server.registerTool(
    "update_gnome",
    {
      title: "Update Gnome",
      description:
        "Update an existing gnome's configuration. For virtual built-in gnomes, " +
        "this creates a project-level copy (copy-on-write). Supports partial " +
        "updates — only supply the fields you want to change.",
      inputSchema: {
        gnomeId: z.string().describe("The gnome's ID (or builtin:slug for virtual built-ins)"),
        projectSlug: z.string().describe("The project's slug (required for copy-on-write of built-ins)"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
        icon: z.string().optional().describe("New emoji icon"),
        categories: z.array(TacticCategory).optional().describe("New tactic categories"),
        defaultModel: z.string().optional().describe("New LLM model"),
        maxPlanTokens: z.number().optional().describe("New max plan tokens"),
        maxExecuteTokens: z.number().optional().describe("New max execute tokens"),
        canAutoExecute: z.boolean().optional().describe("Whether tasks can skip approval"),
        systemPromptTemplate: z.string().optional().describe("New Handlebars system prompt template"),
        toolProviders: z.array(z.string()).optional().describe("New tool provider list"),
        producibleWorkProducts: z.array(z.string()).optional().describe("New work product type slugs"),
      },
    },
    async (args, extra) => {
      const { userId } = await resolveAuth(extra);
      const { gnomeId, projectSlug, ...updates } = args;

      // Copy-on-write for virtual built-ins
      if (gnomeId.startsWith("builtin:")) {
        const builtInSlug = gnomeId.replace("builtin:", "");
        return handleToolCall(() =>
          GnomeService.copyBuiltInToProject(builtInSlug, projectSlug, {
            ...updates,
            lastEditedBy: userId,
          }),
        );
      }

      return handleToolCall(() =>
        GnomeService.updateGnome(gnomeId, {
          ...updates,
          lastEditedBy: userId,
        }),
      );
    },
  );
}
