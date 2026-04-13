import { z } from "zod";
import { after } from "next/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentService, AgentSessionService } from "@/services";
import { handleToolCall } from "./index";
import { resolveAuth } from "../auth";

export function registerAgentTools(server: McpServer) {
  server.registerTool(
    "assign_agent",
    {
      title: "Assign Agent",
      description:
        "Assign an AI agent (gnome) to a task and automatically kick off plan generation. " +
        "By default, the gnome is chosen based on the tactic's category (e.g. Social Media " +
        "Gnome for SOCIAL_MEDIA tactics). Use gnomeSlug to explicitly assign a cross-cutting " +
        "gnome like 'research-gnome' or 'designer-gnome'. Returns the execution record with " +
        "the generated plan. The plan will typically be in AWAITING_APPROVAL status — " +
        "review it and use approve_plan or reject_plan. " +
        "NOTE: This triggers an LLM call and may take several seconds.",
      inputSchema: {
        taskId: z.string().describe("The task's ID to assign an agent to"),
        gnomeSlug: z.string().optional().describe(
          "Optional gnome slug to assign (e.g. 'research-gnome', 'designer-gnome'). " +
          "If omitted, the gnome is auto-resolved from the tactic's category. " +
          "Use this for cross-cutting gnomes that aren't tied to a specific category."
        ),
        agentConfig: z.record(z.string(), z.unknown()).optional().describe("Optional overrides for agent behavior"),
        workProductType: z.string().optional().describe(
          "Optional work product type slug (e.g. 'linkedin-post'). " +
          "When set, the agent will produce a structured artifact of this type " +
          "that goes through work product review before delivery."
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      return handleToolCall(async () => {
        // If a gnomeSlug is provided, pre-set the task's assigneeId so the
        // agent resolver picks up the explicit slug instead of falling back
        // to category-based resolution. This is essential for cross-cutting
        // gnomes (research-gnome, designer-gnome) that have empty categories.
        if (args.gnomeSlug) {
          const { prisma } = await import("@/lib/prisma");
          await prisma.task.update({
            where: { id: args.taskId },
            data: { assigneeId: args.gnomeSlug },
          });
        }

        const result = await AgentService.assignAgent({
          taskId: args.taskId,
          agentConfig: args.agentConfig,
          workProductType: args.workProductType,
        });
        const plan = await AgentService.generatePlan(result.execution.id);

        return { ...result, plan };
      });
    },
  );

  server.registerTool(
    "get_execution",
    {
      title: "Get Execution",
      description:
        "Check the status of an agent execution. Returns the execution record " +
        "with all steps, current status, plan, output, and telemetry. Use this " +
        "to monitor progress after approving a plan, or to review what an agent did.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID"),
      },
    },
    async (args) => {
      return handleToolCall(() => AgentService.getExecution(args.executionId));
    },
  );

  server.registerTool(
    "execute_plan",
    {
      title: "Execute Plan",
      description:
        "Trigger execution of an already-approved plan. Use this when an execution " +
        "is in APPROVED status but hasn't started running (e.g. auto-approved plans " +
        "that weren't auto-executed). " +
        "NOTE: This triggers an LLM call and may take several seconds.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID to execute"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      return handleToolCall(async () => {
        // Phase 3: route through `runApproved` so the per-project
        // managed-agents flag is honored. The managed path doesn't return an
        // ExecutionResult (it's fire-and-forget background polling), so this
        // tool now returns a simple "started" envelope. Use get_execution to
        // check progress.
        await AgentService.runApproved(args.executionId);
        return {
          started: true,
          executionId: args.executionId,
          message:
            "Execution started. Use get_execution to monitor status, telemetry, and work products.",
        };
      });
    },
  );

  server.registerTool(
    "approve_plan",
    {
      title: "Approve Plan",
      description:
        "Approve an agent's execution plan, allowing it to proceed to execution. " +
        "Only works on executions in AWAITING_APPROVAL status. After approval, " +
        "use get_execution to monitor progress.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID to approve"),
        workProductType: z.string().optional().describe(
          "Optional: set or override the work product type at approval time " +
          "(e.g. 'linkedin-post'). Overrides any type declared in the plan."
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const { userId } = await resolveAuth(extra);
      return handleToolCall(async () => {
        const approved = await AgentService.approvePlan(
          args.executionId,
          userId,
          args.workProductType,
        );

        // Phase 3: queue the right background closure based on the
        // `_runMode` discriminator from approvePlan. This is also the Phase 2b
        // bug fix — managed projects no longer fall through to the legacy
        // `executePlan` path.
        after(async () => {
          try {
            if (approved._runMode === "managed-resume") {
              await AgentSessionService.pollUntilIdle(args.executionId);
            } else {
              await AgentService.executePlan(args.executionId);
            }
          } catch (error) {
            console.error(
              `[approve_plan] Background execution failed for ${args.executionId}:`,
              error,
            );
          }
        });

        // Strip `_runMode` from the response — it's an internal discriminator,
        // not part of the public MCP shape.
        const { _runMode, ...publicFields } = approved;
        void _runMode;
        return {
          ...publicFields,
          executionStarted: true,
          message:
            "Execution started in background. Use get_execution to monitor progress.",
        };
      });
    },
  );

  server.registerTool(
    "reject_plan",
    {
      title: "Reject Plan",
      description:
        "Reject an agent's execution plan with an optional reason. The associated " +
        "task resets to TODO so it can be re-assigned with different instructions. " +
        "Provide a reason to help improve the next plan if the task is re-assigned.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID to reject"),
        reason: z.string().optional().describe("Why the plan was rejected — helps improve future plans"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const { userId } = await resolveAuth(extra);
      return handleToolCall(() =>
        AgentService.rejectPlan(args.executionId, userId, args.reason),
      );
    },
  );

  // ── Work Product Tools ──────────────────────────────────

  server.registerTool(
    "get_work_product",
    {
      title: "Get Work Product",
      description:
        "Fetch the current work product for a task execution. Returns the " +
        "latest version with structured data, validation issues, review status, " +
        "delivery status, and agent notes. Use after execution enters WORK_REVIEW.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID"),
      },
    },
    async (args) => {
      return handleToolCall(async () => {
        const execution = await AgentService.getExecution(args.executionId);
        const workProducts = (execution as any).workProducts;
        if (!workProducts || workProducts.length === 0) {
          return { message: "No work product has been produced yet for this execution." };
        }
        return workProducts[0]; // Latest version (ordered desc)
      });
    },
  );

  server.registerTool(
    "review_work_product",
    {
      title: "Review Work Product",
      description:
        "Present the current work product for review, including its structured " +
        "data, review hints, validation issues, and agent notes. Read-only — " +
        "use approve_work_product or request_revision to take action.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID"),
      },
    },
    async (args) => {
      return handleToolCall(async () => {
        const execution = await AgentService.getExecution(args.executionId);
        const workProducts = (execution as any).workProducts;
        if (!workProducts || workProducts.length === 0) {
          return { message: "No work product has been produced yet for this execution." };
        }
        const wp = workProducts[0];

        // Look up the definition for review hints
        const { getWorkProductDefinition } = await import("@/workproducts/registry");
        const definition = getWorkProductDefinition(wp.definitionSlug);

        return {
          workProduct: wp,
          reviewHints: definition?.reviewHints ?? [],
          validationIssues: wp.validationIssues ?? [],
          definitionName: definition?.name ?? wp.definitionSlug,
          renderFormat: definition?.renderFormat ?? "raw",
        };
      });
    },
  );

  server.registerTool(
    "approve_work_product",
    {
      title: "Approve Work Product",
      description:
        "Approve a work product and trigger delivery (if configured). " +
        "Only works when execution is in WORK_REVIEW status. Optionally " +
        "provide edits to overlay on the work product data before delivery.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID to approve"),
        edits: z.record(z.string(), z.unknown()).optional().describe(
          "Optional edits to overlay on the work product data (e.g. corrected copy)"
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const { userId } = await resolveAuth(extra);
      return handleToolCall(async () => {
        // Phase 4: route through `runWorkProductReview` so the per-project
        // managed-agents flag is honored. This closes the §8e Critical bug 2
        // pattern for the work-product approve surface — MCP was bypassing
        // the gate the same way approve_plan was before Phase 3.
        const result = await AgentService.runWorkProductReview(
          args.executionId,
          userId,
          "approve",
          { edits: args.edits },
        );

        if (result._runMode === "managed-resume") {
          after(async () => {
            try {
              await AgentSessionService.pollUntilIdle(args.executionId);
            } catch (error) {
              console.error(
                `[approve_work_product] pollUntilIdle failed for ${args.executionId}:`,
                error,
              );
            }
          });
        }

        const { _runMode, ...publicFields } = result;
        void _runMode;
        if (publicFields.deliveryResult) return publicFields;
        return { ...publicFields, message: "Approved. No delivery adapter configured." };
      });
    },
  );

  server.registerTool(
    "request_revision",
    {
      title: "Request Work Product Revision",
      description:
        "Send the work product back for revision with notes explaining what " +
        "needs to change. The agent will re-run production with your feedback " +
        "as context. Optionally provide direct edits.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID"),
        notes: z.string().describe("What needs to change — the agent sees this during revision"),
        edits: z.record(z.string(), z.unknown()).optional().describe(
          "Optional direct edits to specific fields"
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const { userId } = await resolveAuth(extra);
      return handleToolCall(async () => {
        const result = await AgentService.runWorkProductReview(
          args.executionId,
          userId,
          "request_revision",
          { notes: args.notes, edits: args.edits },
        );

        if (result._runMode === "managed-resume") {
          after(async () => {
            try {
              await AgentSessionService.pollUntilIdle(args.executionId);
            } catch (error) {
              console.error(
                `[request_revision] pollUntilIdle failed for ${args.executionId}:`,
                error,
              );
            }
          });
        }

        const { _runMode, ...publicFields } = result;
        const message =
          _runMode === "managed-resume"
            ? "Revision requested. The agent has been notified and is retrying."
            : "Revision requested. Use assign_agent or retry to re-run production.";
        return { ...publicFields, message };
      });
    },
  );

  server.registerTool(
    "reject_work_product",
    {
      title: "Reject Work Product",
      description:
        "Reject a work product with an optional reason. Marks the execution " +
        "FAILED and resets the parent task to TODO. For managed-agents " +
        "projects this also interrupts and archives the live session.",
      inputSchema: {
        executionId: z.string().describe("The execution's ID"),
        reason: z.string().optional().describe(
          "Why the work product was rejected — surfaced to the agent's transcript"
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args, extra) => {
      const { userId } = await resolveAuth(extra);
      return handleToolCall(async () => {
        const result = await AgentService.runWorkProductReview(
          args.executionId,
          userId,
          "reject",
          { reason: args.reason },
        );
        const { _runMode, ...publicFields } = result;
        void _runMode;
        return publicFields;
      });
    },
  );
}
