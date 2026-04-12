import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError, ForbiddenError } from "@/lib/errors";
import { resolveToolsFromCredentials } from "@/agents/tools/registry";
import { loadProjectCredentials } from "./metrics-config.service";
import { getAgentDefinition } from "@/agents/definitions";
import { resolveAgent, resolveAgentBySlug } from "@/agents/resolve";
import { buildKnowledgeBlock } from "./document.service";
import { getWorkProductDefinition, isWorkProductRegistered } from "@/workproducts";
import { getDeliveryAdapter } from "@/delivery";
import type { ExecutionStatus, Prisma } from "@prisma/client";
import type { AgentDefinition, AgentContext, ExecutionPlan, ExecutionResult, StepResult, ResolvedTool } from "@/agents/types";
import type { WorkProductDefinition, ValidationIssue } from "@/workproducts/types";
import type { DeliveryResult } from "@/delivery/types";
import * as AgentSessionService from "./agent.session.service";

const MAX_REVISION_ROUNDS = 3;

// ── Managed Agents feature flag ──────────────────────────

/**
 * True when this execution should run via the Managed Agents session path
 * instead of the legacy `callLLMForPlan` / `executePlan` loop. The gate is
 * the AND of a global env flag and a per-project opt-in. The execution must
 * be loaded with `task.tactic.project` for this helper to work.
 */
function isManagedExecution(execution: {
  task: { tactic: { project: { enableManagedAgents: boolean } } };
}): boolean {
  return (
    process.env.MARYMARY_MANAGED_AGENTS_ENABLED === "true" &&
    execution.task.tactic.project.enableManagedAgents === true
  );
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Validate that a work product type slug is registered and (optionally)
 * that the agent is allowed to produce it.
 */
function validateWorkProductType(slug: string, agentDef?: { producibleWorkProducts?: string[]; name: string }) {
  if (!isWorkProductRegistered(slug)) {
    throw new ValidationError(`Work product type "${slug}" is not registered`);
  }
  if (agentDef?.producibleWorkProducts && agentDef.producibleWorkProducts.length > 0) {
    if (!agentDef.producibleWorkProducts.includes(slug)) {
      throw new ValidationError(
        `Agent "${agentDef.name}" cannot produce work product type "${slug}". ` +
        `Allowed types: ${agentDef.producibleWorkProducts.join(", ")}`
      );
    }
  }
}

// ── Task Assignment ───────────────────────────────────────

export interface AssignAgentInput {
  taskId: string;
  agentConfig?: Record<string, unknown>;
  /** Explicit work product type for this execution (validated against registry + agent capabilities) */
  workProductType?: string;
}

/**
 * Assign an agent to a task and kick off the planning phase.
 */
export async function assignAgent(input: AssignAgentInput) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    include: { tactic: { include: { project: true } } },
  });
  if (!task) throw new NotFoundError("Task", input.taskId);

  if (task.assigneeType === "AGENT" && task.status === "IN_PROGRESS") {
    throw new ValidationError("Task is already assigned to an agent and in progress");
  }

  // Resolve the gnome/agent definition.
  // If the task already has an assigneeId (e.g. set by request_media_design tool),
  // try to resolve by that slug first. Otherwise fall back to tactic category.
  let agentDef = task.assigneeId
    ? await resolveAgentBySlug(task.tactic.project.id, task.assigneeId, task.tactic.category)
    : undefined;
  if (!agentDef) {
    agentDef = await resolveAgent(task.tactic.project.id, task.tactic.category);
  }
  if (!agentDef) {
    throw new ValidationError(`No gnome found for tactic category: ${task.tactic.category}`);
  }

  // Update the task
  await prisma.task.update({
    where: { id: input.taskId },
    data: {
      assigneeType: "AGENT",
      assigneeId: agentDef.id,
      agentConfig: (input.agentConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      status: "IN_PROGRESS",
    },
  });

  // Validate work product type if provided
  if (input.workProductType) {
    validateWorkProductType(input.workProductType, agentDef);
  }

  // Auto-resolve work product type when the agent has exactly one producible type
  // and the caller didn't specify one. Reduces friction for the common case
  // (e.g. social media agent always produces linkedin-post).
  let resolvedWorkProductType = input.workProductType;
  if (!resolvedWorkProductType && agentDef.producibleWorkProducts?.length === 1) {
    resolvedWorkProductType = agentDef.producibleWorkProducts[0];
    validateWorkProductType(resolvedWorkProductType, agentDef);
  }

  // Create a new execution
  const execution = await prisma.taskExecution.create({
    data: {
      taskId: input.taskId,
      status: "QUEUED",
      model: agentDef.defaultModel,
      workProductType: resolvedWorkProductType,
    },
  });

  return {
    task: await prisma.task.findUnique({ where: { id: input.taskId } }),
    execution,
    agentDefinition: { id: agentDef.id, name: agentDef.name },
  };
}

// ── Plan Generation ───────────────────────────────────────

/**
 * Generate an execution plan for a queued task.
 * Moves the execution from QUEUED → PLANNING → AWAITING_APPROVAL.
 */
export async function generatePlan(executionId: string): Promise<ExecutionPlan> {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: { include: { tactic: { include: { project: true } } } },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  if (execution.status !== "QUEUED") {
    throw new ValidationError(`Cannot generate plan for execution in status: ${execution.status}`);
  }

  // Phase 3: managed-agents projects open a session here and let the agent
  // call `marymary_submit_plan` natively. The session pauses on
  // `requires_action`, persistPendingPlan flips the row to AWAITING_APPROVAL,
  // and we re-load the persisted plan for parity with the legacy return shape.
  if (isManagedExecution(execution)) {
    return AgentSessionService.generatePlanViaSession(executionId);
  }

  // Move to PLANNING
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: "PLANNING", startedAt: new Date() },
  });

  try {
    // Resolve gnome — prefer slug-based resolution (e.g. designer-gnome assigned
    // via request_media_design), fall back to category-based resolution.
    let agentDef = execution.task.assigneeId
      ? await resolveAgentBySlug(execution.task.tactic.project.id, execution.task.assigneeId, execution.task.tactic.category)
      : undefined;
    if (!agentDef) {
      agentDef = await resolveAgent(execution.task.tactic.project.id, execution.task.tactic.category);
    }
    if (!agentDef) throw new ValidationError("No gnome found");
    const context = await buildAgentContext(execution.task, execution, agentDef);

    // Call the LLM to generate a plan
    const orgId = execution.task.tactic.project.organizationId;
    if (!orgId) throw new ValidationError("Project must belong to an organization to execute tasks.");
    const plan = await callLLMForPlan(agentDef, context, orgId);

    // If the plan declares a work product type and execution doesn't have one yet, persist it
    const declaredWpType = plan.workProductType;
    let resolvedWpType = execution.workProductType; // may already be set from assignAgent()
    if (declaredWpType && !resolvedWpType) {
      validateWorkProductType(declaredWpType, agentDef);
      resolvedWpType = declaredWpType;
    }

    // Store the plan and move to AWAITING_APPROVAL
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: "AWAITING_APPROVAL",
        plan: plan as unknown as Prisma.JsonObject,
        planModel: agentDef.defaultModel,
        ...(resolvedWpType !== execution.workProductType ? { workProductType: resolvedWpType } : {}),
      },
    });

    return plan;
  } catch (error) {
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Plan generation failed",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

// ── Approval ──────────────────────────────────────────────

export async function approvePlan(executionId: string, userId: string, workProductType?: string) {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: { task: { include: { tactic: { include: { project: true } } } } },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  if (execution.status !== "AWAITING_APPROVAL") {
    throw new ValidationError(`Cannot approve execution in status: ${execution.status}`);
  }

  // Allow reviewer to set or override workProductType at approval time
  let resolvedWpType = execution.workProductType;
  if (workProductType) {
    let agentDef = execution.task.assigneeId
      ? await resolveAgentBySlug(execution.task.tactic.project.id, execution.task.assigneeId, execution.task.tactic.category)
      : undefined;
    if (!agentDef) {
      agentDef = await resolveAgent(execution.task.tactic.project.id, execution.task.tactic.category);
    }
    validateWorkProductType(workProductType, agentDef);
    resolvedWpType = workProductType;
  }

  const updated = await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: userId,
      ...(resolvedWpType !== execution.workProductType ? { workProductType: resolvedWpType } : {}),
    },
  });

  // Phase 3: on the managed-agents path, the session is alive and idle on a
  // `marymary_submit_plan` requires_action. Resolve the custom tool call so
  // the session resumes naturally when the caller wraps `pollUntilIdle` in
  // `after()`. The `_runMode` discriminator tells route + MCP callers which
  // background closure to enqueue.
  if (isManagedExecution(execution)) {
    await AgentSessionService.resumeSessionAfterApproval(executionId, userId);
    return { ...updated, _runMode: "managed-resume" as const };
  }

  return { ...updated, _runMode: "legacy" as const };
}

export async function rejectPlan(executionId: string, userId: string, reason?: string) {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: { task: { include: { tactic: { include: { project: true } } } } },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  if (execution.status !== "AWAITING_APPROVAL") {
    throw new ValidationError(`Cannot reject execution in status: ${execution.status}`);
  }

  // Phase 3: managed path resolves the pending submit_plan with
  // `approved: false`, interrupts + archives the session, then writes the
  // same REJECTED row + task reset that the legacy path does.
  if (isManagedExecution(execution)) {
    await AgentSessionService.cancelSessionWithRejection(executionId, userId, reason);
    return { rejected: true, executionId };
  }

  // Reject the execution and reset the task
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedBy: userId,
      rejectionReason: reason,
      completedAt: new Date(),
    },
  });

  // Reset task status so it can be re-assigned
  await prisma.task.update({
    where: { id: execution.taskId },
    data: { status: "TODO" },
  });

  return { rejected: true, executionId };
}

// ── Execution ─────────────────────────────────────────────

/**
 * Single entry point for "run an already-approved plan", used by both the
 * execute route and the MCP `execute_plan` handler. Phase 3: branches on the
 * managed-agents flag — managed projects open a fresh session (auto-execute
 * gnomes) or call back into `pollUntilIdle` for a session that was already
 * resumed by `approvePlan`. Legacy projects fall through to `executePlan`.
 *
 * Idempotency: managed-resume from `approvePlan` already kicked the session,
 * so a row with `externalSessionId != null && status === "PRODUCING"` is
 * already in flight — `startSessionForTask` will short-circuit on its own
 * idempotency guard, then `pollUntilIdle` will drain the running session.
 */
export async function runApproved(executionId: string): Promise<void> {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: { task: { include: { tactic: { include: { project: true } } } } },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  if (execution.status !== "APPROVED" && execution.status !== "PRODUCING") {
    throw new ValidationError(
      `Cannot run execution in status: ${execution.status} (expected APPROVED or PRODUCING)`,
    );
  }

  if (isManagedExecution(execution)) {
    // For auto-execute gnomes (no submit_plan call): open a fresh session.
    // For approve-then-resume gnomes: the session is already running and
    // startSessionForTask short-circuits via its idempotency guard.
    if (!execution.externalSessionId) {
      await AgentSessionService.startSessionForTask(executionId);
    }
    await AgentSessionService.pollUntilIdle(executionId);
    return;
  }

  await executePlan(executionId);
}

/**
 * Execute an approved plan.
 * Moves APPROVED → RUNNING → COMPLETED/FAILED.
 */
export async function executePlan(executionId: string): Promise<ExecutionResult> {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: { include: { tactic: { include: { project: true } } } },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  if (execution.status !== "APPROVED") {
    throw new ValidationError(`Cannot execute plan in status: ${execution.status}`);
  }

  const startTime = Date.now();

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: "PRODUCING" },
  });

  try {
    // Resolve gnome — prefer slug-based resolution (e.g. designer-gnome assigned
    // via request_media_design), fall back to category-based resolution.
    let agentDef = execution.task.assigneeId
      ? await resolveAgentBySlug(execution.task.tactic.project.id, execution.task.assigneeId, execution.task.tactic.category)
      : undefined;
    if (!agentDef) {
      agentDef = await resolveAgent(execution.task.tactic.project.id, execution.task.tactic.category);
    }
    if (!agentDef) throw new ValidationError("No gnome found");
    const context = await buildAgentContext(execution.task, execution, agentDef);

    const plan = execution.plan as unknown as ExecutionPlan;

    // Execute the plan via LLM
    const orgId = execution.task.tactic.project.organizationId;
    if (!orgId) throw new ValidationError("Project must belong to an organization to execute tasks.");
    console.log(`[executePlan] Agent: ${agentDef.id}, hasOverride: ${!!agentDef.executeOverride}`);
    const result = agentDef.executeOverride
      ? await agentDef.executeOverride(agentDef, context, plan, orgId)
      : await callLLMForExecution(agentDef, context, plan, orgId);

    const durationMs = Date.now() - startTime;

    // Write execution steps
    for (const step of result.steps) {
      await prisma.executionStep.create({
        data: {
          executionId,
          stepIndex: step.stepIndex,
          type: step.type,
          action: step.action,
          description: step.description,
          tool: step.tool,
          toolInput: step.toolInput as Prisma.JsonObject | undefined,
          toolOutput: (step.toolOutput ?? undefined) as Prisma.InputJsonValue | undefined,
          llmResponse: step.llmResponse,
          status: step.status,
          error: step.error,
          durationMs: step.durationMs,
          completedAt: new Date(),
        },
      });
    }

    // Telemetry + work-product / completion branching. Extracted so the
    // Phase 2 Managed Agents session path can reuse the exact same tail
    // without duplicating the work-product submission / DONE-transition
    // logic. See `finalizeExecutionResult`.
    await finalizeExecutionResult(executionId, execution.workProductType, {
      success: result.success,
      output: result.output,
      outputText: result.outputText,
      workProductData: result.workProductData,
      telemetry: result.telemetry,
      durationMs,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Execution failed",
        durationMs,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

// ── Shared: finalize telemetry + work product branch ──────

/**
 * Write final execution telemetry and run the work-product / completion
 * branch. Shared between the legacy `executePlan` tail and the Phase 2
 * Managed Agents session path (`agent.session.service.ts`) so the
 * WORK_REVIEW transition and task DONE-ing stays in exactly one place.
 *
 * This helper intentionally does NOT write ExecutionStep rows — the legacy
 * path batch-writes steps from its 20-turn loop result before calling this,
 * and the session path writes steps incrementally as it hydrates events.
 */
export async function finalizeExecutionResult(
  executionId: string,
  workProductType: string | null,
  result: {
    success: boolean;
    output: Record<string, unknown>;
    outputText: string;
    workProductData?: Record<string, unknown>;
    telemetry: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      toolCalls: number;
    };
    durationMs: number;
  },
): Promise<void> {
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      output: result.output as Prisma.JsonObject,
      outputText: result.outputText,
      model: result.telemetry.model,
      inputTokens: result.telemetry.inputTokens,
      outputTokens: result.telemetry.outputTokens,
      totalTokens: result.telemetry.totalTokens,
      durationMs: result.durationMs,
      toolCalls: result.telemetry.toolCalls,
    },
  });

  if (workProductType && result.workProductData) {
    // Transitions execution to WORK_REVIEW (or auto-approved → DELIVERING/COMPLETED).
    await submitWorkProduct(executionId, workProductType, result.workProductData, result.outputText);
    return;
  }

  // No work product — legacy flow: mark completed/failed and bump the task.
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: result.success ? "COMPLETED" : "FAILED",
      completedAt: new Date(),
    },
  });

  if (result.success) {
    const row = await prisma.taskExecution.findUnique({
      where: { id: executionId },
      select: { taskId: true },
    });
    if (row) {
      await prisma.task.update({
        where: { id: row.taskId },
        data: { status: "DONE", completedAt: new Date() },
      });
    }
  }
}

// ── Cancel ────────────────────────────────────────────────

export async function cancelExecution(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  const cancellableStatuses: ExecutionStatus[] = [
    "QUEUED", "PLANNING", "AWAITING_APPROVAL", "APPROVED",
    "PRODUCING", "WORK_REVIEW", "REVISION_REQUESTED", "DELIVERING",
  ];
  if (!cancellableStatuses.includes(execution.status)) {
    throw new ValidationError(`Cannot cancel execution in status: ${execution.status}`);
  }

  return prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}

// ── Work Product Lifecycle ────────────────────────────

/**
 * Persist a work product and move execution to WORK_REVIEW.
 * Called by executePlan() and retryProduction() after the LLM produces output,
 * and (Phase 4) by `agent.session.service.persistPendingWorkProduct` after the
 * managed-agents `marymary_submit_work_product` custom tool fires. Exported so
 * the session service can reuse the same versioning logic without duplication.
 */
export async function submitWorkProduct(
  executionId: string,
  definitionSlug: string,
  data: Record<string, unknown>,
  agentNotes?: string,
) {
  const definition = getWorkProductDefinition(definitionSlug);
  if (!definition) {
    throw new ValidationError(`Work product type "${definitionSlug}" is not registered`);
  }

  // Run validators (informational — results are stored but don't block review)
  const validationIssues: ValidationIssue[] = [];
  for (const validator of definition.validators) {
    const issues = validator(data);
    validationIssues.push(...issues);
  }

  // Determine the version number (increment if revision)
  const existingProducts = await prisma.workProduct.findMany({
    where: { executionId },
    orderBy: { version: "desc" },
    take: 1,
  });
  const version = existingProducts.length > 0 ? existingProducts[0].version + 1 : 1;
  const previousVersionId = existingProducts.length > 0 ? existingProducts[0].id : undefined;

  const reviewStatus = "PENDING_REVIEW";

  // Create the work product record
  const workProduct = await prisma.workProduct.create({
    data: {
      executionId,
      definitionSlug,
      version,
      data: data as Prisma.JsonObject,
      agentNotes,
      validationIssues: validationIssues.length > 0
        ? (validationIssues as unknown as Prisma.JsonArray)
        : undefined,
      reviewStatus,
      previousVersionId,
    },
  });

  // Auto-attach any media assets queued during PRODUCING
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    select: { pendingMediaIds: true },
  });
  if (execution?.pendingMediaIds?.length) {
    const { attachMedia } = await import("@/services/media-attachment.service");
    for (const mediaAssetId of execution.pendingMediaIds) {
      try {
        await attachMedia({
          workProductId: workProduct.id,
          mediaAssetId,
          source: "GNOME_SUGGESTED",
        });
      } catch {
        // Best-effort: asset may have been deleted or already attached
      }
    }
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { pendingMediaIds: [] },
    });
  }

  // Log a WORK_PRODUCT_CREATED step
  const stepCount = await prisma.executionStep.count({ where: { executionId } });
  await prisma.executionStep.create({
    data: {
      executionId,
      stepIndex: stepCount,
      type: "WORK_PRODUCT_CREATED",
      action: "submit_work_product",
      description: `Created ${definitionSlug} work product v${version}`,
      toolOutput: { workProductId: workProduct.id, version, validationIssues } as unknown as Prisma.JsonObject,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  // Move to WORK_REVIEW for human review
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: "WORK_REVIEW" },
  });

  return workProduct;
}

/**
 * Review a work product: approve, request revision, or reject.
 *
 * Returns the updated WorkProduct row plus an internal `_runMode` discriminator
 * that callers (HTTP routes, MCP tools) use to decide whether to queue a
 * background `pollUntilIdle` for the managed-agents session. The discriminator
 * is internal — `runWorkProductReview` strips it from the response surface.
 *
 *   - `legacy`         — non-managed project; behaves exactly like Phase 1.
 *                        The caller may need to trigger delivery / retry on
 *                        its own (same as today).
 *   - `managed-resume` — managed project, approve or revision; the session
 *                        is alive and the caller MUST queue
 *                        `AgentSessionService.pollUntilIdle` in `after()` so
 *                        the session reaches its next stop and we capture
 *                        final telemetry.
 *   - `managed-rejected` — managed project, reject; the session has been
 *                        interrupted + archived. No follow-up polling needed.
 */
export async function reviewWorkProduct(
  executionId: string,
  userId: string,
  action: "approve" | "request_revision" | "reject",
  notes?: string,
  edits?: Record<string, unknown>,
) {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      workProducts: { orderBy: { version: "desc" }, take: 1 },
      task: { include: { tactic: { include: { project: true } } } },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);
  const managed = isManagedExecution(execution);

  if (execution.status !== "WORK_REVIEW") {
    throw new ValidationError(`Cannot review work product for execution in status: ${execution.status}`);
  }

  const workProduct = execution.workProducts[0];
  if (!workProduct) {
    throw new ValidationError("No work product found for this execution");
  }

  const definition = getWorkProductDefinition(workProduct.definitionSlug);

  // Log the review action
  const stepCount = await prisma.executionStep.count({ where: { executionId } });
  await prisma.executionStep.create({
    data: {
      executionId,
      stepIndex: stepCount,
      type: "REVIEW_ACTION",
      action: `review_${action}`,
      description: `Reviewer ${action === "approve" ? "approved" : action === "request_revision" ? "requested revision of" : "rejected"} work product v${workProduct.version}`,
      toolOutput: { action, notes, hasEdits: !!edits } as Prisma.JsonObject,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  if (action === "approve") {
    // Approve the work product
    await prisma.workProduct.update({
      where: { id: workProduct.id },
      data: {
        reviewStatus: "APPROVED",
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewerNotes: notes,
        reviewerEdits: edits ? (edits as Prisma.JsonObject) : undefined,
      },
    });

    // Move to DELIVERING or COMPLETED
    if (definition?.delivery) {
      await prisma.taskExecution.update({
        where: { id: executionId },
        data: { status: "DELIVERING" },
      });
    } else {
      await prisma.workProduct.update({
        where: { id: workProduct.id },
        data: { deliveryStatus: "SKIPPED" },
      });
      await prisma.taskExecution.update({
        where: { id: executionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await prisma.task.update({
        where: { id: execution.taskId },
        data: { status: "DONE", completedAt: new Date() },
      });
    }

    // Phase 4: notify the live session that the work product was accepted.
    // The session will reach end_turn quickly and the caller's pollUntilIdle
    // captures final telemetry. Auto-approved (system) reviews skip this —
    // persistPendingWorkProduct already resolved the tool call inline.
    if (managed && userId !== "system") {
      await AgentSessionService.approveWorkProductInSession(executionId, userId, edits);
    }

    const wp = await prisma.workProduct.findUnique({ where: { id: workProduct.id } });
    return {
      workProduct: wp,
      _runMode: managed && userId !== "system" ? ("managed-resume" as const) : ("legacy" as const),
    };

  } else if (action === "request_revision") {
    // Check revision limit
    if (workProduct.version >= MAX_REVISION_ROUNDS) {
      throw new ValidationError(
        `Maximum revision rounds (${MAX_REVISION_ROUNDS}) reached. ` +
        `The task must be handled manually or rejected.`
      );
    }

    // Mark current work product as revision requested
    await prisma.workProduct.update({
      where: { id: workProduct.id },
      data: {
        reviewStatus: "REVISION_REQUESTED",
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewerNotes: notes,
        reviewerEdits: edits ? (edits as Prisma.JsonObject) : undefined,
      },
    });

    // Phase 4: in managed mode, send the feedback into the live session via
    // a custom_tool_result and let the agent retry IN-SESSION. The helper
    // also flips the row back to PRODUCING + clears the pending fields, so
    // we don't enter the REVISION_REQUESTED status at all on the managed
    // path. Legacy path keeps using REVISION_REQUESTED + retryProduction.
    if (managed) {
      await AgentSessionService.requestRevisionInSession(
        executionId,
        userId,
        notes ?? "",
        edits,
      );
    } else {
      await prisma.taskExecution.update({
        where: { id: executionId },
        data: { status: "REVISION_REQUESTED" },
      });
    }

    const wp = await prisma.workProduct.findUnique({ where: { id: workProduct.id } });
    return {
      workProduct: wp,
      _runMode: managed ? ("managed-resume" as const) : ("legacy" as const),
    };

  } else {
    // Reject — fail the execution and reset the task
    await prisma.workProduct.update({
      where: { id: workProduct.id },
      data: {
        reviewStatus: "REJECTED",
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewerNotes: notes,
      },
    });

    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        error: `Work product rejected${notes ? `: ${notes}` : ""}`,
        completedAt: new Date(),
      },
    });

    await prisma.task.update({
      where: { id: execution.taskId },
      data: { status: "TODO" },
    });

    // Phase 4: tear down the live session for managed projects. Best-effort —
    // we never let session-side errors block the local rejection from landing.
    if (managed) {
      try {
        await AgentSessionService.rejectWorkProductInSession(executionId, userId, notes);
      } catch (err) {
        console.warn(
          `[managed-agents] rejectWorkProductInSession failed for ${executionId}:`,
          err,
        );
      }
    }

    const wp = await prisma.workProduct.findUnique({ where: { id: workProduct.id } });
    return {
      workProduct: wp,
      _runMode: managed ? ("managed-rejected" as const) : ("legacy" as const),
    };
  }
}

/**
 * Phase 4: unified entry point for human work-product review actions.
 * Mirrors `runApproved` for plan approvals — HTTP routes and MCP tools call
 * this instead of `reviewWorkProduct` directly so the managed-vs-legacy
 * dispatch lives in exactly one place. Closes the §8e Critical bug 2 pattern
 * for the work-product surface (MCP was bypassing the gate the same way
 * approve_plan was before Phase 3).
 *
 * Side effects performed here:
 *   - Synchronously runs `deliverWorkProduct` after a successful approve when
 *     the work product type has a configured delivery adapter. Mirrors what
 *     the legacy approve route did inline.
 *   - For `_runMode === "managed-resume"`, the caller is responsible for
 *     queuing `AgentSessionService.pollUntilIdle(executionId)` in `after()`.
 *     This function does NOT queue it itself, because Next's `after()` is
 *     route-scoped and we don't want to leak it across MCP/HTTP entry points.
 *
 * Returns the public response shape (workProduct + optional deliveryResult)
 * plus the `_runMode` discriminator for the caller's background dispatch.
 * Caller is expected to strip `_runMode` before sending to the client.
 */
export async function runWorkProductReview(
  executionId: string,
  userId: string,
  action: "approve" | "request_revision" | "reject",
  payload?: { notes?: string; reason?: string; edits?: Record<string, unknown> },
): Promise<{
  workProduct: Awaited<ReturnType<typeof prisma.workProduct.findUnique>>;
  deliveryResult?: DeliveryResult;
  _runMode: "legacy" | "managed-resume" | "managed-rejected";
}> {
  const notes =
    action === "request_revision"
      ? payload?.notes
      : action === "reject"
        ? payload?.reason
        : undefined;
  const result = await reviewWorkProduct(executionId, userId, action, notes, payload?.edits);

  // For an approve, run delivery synchronously the same way the legacy
  // route did. This stays decoupled from session lifecycle — the session
  // resume is handled separately by the caller's `after()`-queued
  // pollUntilIdle. Delivery only runs when the row landed in DELIVERING.
  if (action === "approve") {
    const after = await prisma.taskExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    if (after?.status === "DELIVERING") {
      const deliveryResult = await deliverWorkProduct(executionId);
      return {
        workProduct: result.workProduct,
        deliveryResult,
        _runMode: result._runMode,
      };
    }
  }

  return {
    workProduct: result.workProduct,
    _runMode: result._runMode,
  };
}

/**
 * Re-run production after a revision request.
 * Rebuilds context with the previous work product + reviewer notes,
 * then runs the LLM again to produce a revised work product.
 */
export async function retryProduction(executionId: string): Promise<ExecutionResult> {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: { include: { tactic: { include: { project: true } } } },
      workProducts: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  if (execution.status !== "REVISION_REQUESTED") {
    throw new ValidationError(`Cannot retry production for execution in status: ${execution.status}`);
  }

  const startTime = Date.now();

  // Move back to PRODUCING
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: "PRODUCING" },
  });

  try {
    // Build context — this will now include previousWorkProduct from the revision
    let agentDef = execution.task.assigneeId
      ? await resolveAgentBySlug(execution.task.tactic.project.id, execution.task.assigneeId, execution.task.tactic.category)
      : undefined;
    if (!agentDef) {
      agentDef = await resolveAgent(execution.task.tactic.project.id, execution.task.tactic.category);
    }
    if (!agentDef) throw new ValidationError("No gnome found");
    const context = await buildAgentContext(execution.task, execution, agentDef);

    const plan = execution.plan as unknown as ExecutionPlan;

    // Re-execute with revision context
    const orgId = execution.task.tactic.project.organizationId;
    if (!orgId) throw new ValidationError("Project must belong to an organization to execute tasks.");
    const result = agentDef.executeOverride
      ? await agentDef.executeOverride(agentDef, context, plan, orgId)
      : await callLLMForExecution(agentDef, context, plan, orgId);

    const durationMs = Date.now() - startTime;

    // Write new execution steps
    const existingStepCount = await prisma.executionStep.count({ where: { executionId } });
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      await prisma.executionStep.create({
        data: {
          executionId,
          stepIndex: existingStepCount + i,
          type: step.type,
          action: step.action,
          description: step.description,
          tool: step.tool,
          toolInput: step.toolInput as Prisma.JsonObject | undefined,
          toolOutput: (step.toolOutput ?? undefined) as Prisma.InputJsonValue | undefined,
          llmResponse: step.llmResponse,
          status: step.status,
          error: step.error,
          durationMs: step.durationMs,
          completedAt: new Date(),
        },
      });
    }

    // Update telemetry (accumulate with previous runs)
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        output: result.output as Prisma.JsonObject,
        outputText: result.outputText,
        inputTokens: (execution.inputTokens ?? 0) + result.telemetry.inputTokens,
        outputTokens: (execution.outputTokens ?? 0) + result.telemetry.outputTokens,
        totalTokens: (execution.totalTokens ?? 0) + result.telemetry.totalTokens,
        durationMs: (execution.durationMs ?? 0) + durationMs,
        toolCalls: (execution.toolCalls ?? 0) + result.telemetry.toolCalls,
      },
    });

    // Submit the revised work product
    const wpType = execution.workProductType;
    if (wpType && result.workProductData) {
      await submitWorkProduct(executionId, wpType, result.workProductData, result.outputText);
    } else if (wpType && result.success) {
      // Agent succeeded but didn't produce structured data — move to FAILED
      await prisma.taskExecution.update({
        where: { id: executionId },
        data: {
          status: "FAILED",
          error: "Agent did not produce structured work product data during revision",
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.taskExecution.update({
        where: { id: executionId },
        data: {
          status: "FAILED",
          error: "Revision production failed",
          completedAt: new Date(),
        },
      });
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Revision production failed",
        durationMs: (execution.durationMs ?? 0) + durationMs,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

/**
 * Deliver an approved work product via its configured delivery adapter.
 */
export async function deliverWorkProduct(executionId: string): Promise<DeliveryResult> {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: { include: { tactic: { include: { project: true } } } },
      workProducts: {
        where: { reviewStatus: { in: ["APPROVED", "AUTO_APPROVED"] } },
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", executionId);

  // Accept either DELIVERING (the immediate post-approval path) or
  // WORK_REVIEW (the scheduled-delivery path, where we stay in review
  // until the scheduler fires). Any other status is a hard error.
  if (execution.status !== "DELIVERING" && execution.status !== "WORK_REVIEW") {
    throw new ValidationError(`Cannot deliver for execution in status: ${execution.status}`);
  }
  if (execution.status === "WORK_REVIEW") {
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { status: "DELIVERING" },
    });
  }

  const workProduct = execution.workProducts[0];
  if (!workProduct) {
    throw new ValidationError("No approved work product found for delivery");
  }

  const definition = getWorkProductDefinition(workProduct.definitionSlug);
  if (!definition?.delivery) {
    throw new ValidationError(`Work product type "${workProduct.definitionSlug}" has no delivery configured`);
  }

  const adapter = getDeliveryAdapter(definition.delivery.adapterSlug);
  if (!adapter) {
    throw new ValidationError(`Delivery adapter "${definition.delivery.adapterSlug}" is not registered`);
  }

  // Update delivery status to pending
  await prisma.workProduct.update({
    where: { id: workProduct.id },
    data: {
      deliveryStatus: "PENDING_DELIVERY",
      deliveryAttempts: workProduct.deliveryAttempts + 1,
    },
  });

  // Assemble delivery payload
  const project = execution.task.tactic.project;

  // Resolve delivery credentials from org-level API keys
  let credentials: Record<string, Record<string, unknown>> | undefined;
  if (project.organizationId && adapter.requiredCredentials.length > 0) {
    const { getDecryptedApiKey } = await import("./api-key.service");
    credentials = {};
    for (const credKey of adapter.requiredCredentials) {
      const upperKey = credKey.toUpperCase();
      const apiKey = await getDecryptedApiKey(project.organizationId, `${upperKey}_API_KEY`);
      const accountId = await getDecryptedApiKey(project.organizationId, `${upperKey}_ACCOUNT_ID`);
      if (apiKey || accountId) {
        credentials[credKey] = {
          ...(apiKey ? { apiKey } : {}),
          ...(accountId ? { [`${credKey}AccountId`]: accountId } : {}),
        };
      }
    }
  }

  // Fetch media attachments for the work product
  const { listAttachments } = await import("./media-attachment.service");
  const attachments = await listAttachments(workProduct.id);
  const mediaAttachments = attachments
    .filter((att) => att.mediaAsset.imageUrl)
    .map((att) => ({
      url: att.mediaAsset.imageUrl!,
      mimeType: att.mediaAsset.mimeType ?? "image/png",
      altText: att.altText ?? undefined,
      caption: att.caption ?? undefined,
    }));

  const payload = {
    workProduct: {
      definitionSlug: workProduct.definitionSlug,
      data: workProduct.data as Record<string, unknown>,
      version: workProduct.version,
      reviewerEdits: workProduct.reviewerEdits as Record<string, unknown> | undefined,
      mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
    },
    credentials,
    projectContext: {
      projectName: project.name,
      projectSlug: project.slug,
      organizationName: undefined as string | undefined,
    },
  };

  // Log the delivery attempt
  const stepCount = await prisma.executionStep.count({ where: { executionId } });

  try {
    const result = await adapter.deliver(payload);

    await prisma.executionStep.create({
      data: {
        executionId,
        stepIndex: stepCount,
        type: "DELIVERY_ATTEMPT",
        action: `deliver_via_${adapter.slug}`,
        description: result.success
          ? `Delivered via ${adapter.name}`
          : `Delivery failed via ${adapter.name}: ${result.error}`,
        toolOutput: result as unknown as Prisma.JsonObject,
        status: result.success ? "COMPLETED" : "FAILED",
        error: result.error,
        completedAt: new Date(),
      },
    });

    if (result.success) {
      await prisma.workProduct.update({
        where: { id: workProduct.id },
        data: {
          deliveryStatus: "DELIVERED",
          deliveryResult: result as unknown as Prisma.JsonObject,
          deliveredAt: new Date(),
        },
      });

      await prisma.taskExecution.update({
        where: { id: executionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      await prisma.task.update({
        where: { id: execution.taskId },
        data: { status: "DONE", completedAt: new Date() },
      });
    } else {
      await prisma.workProduct.update({
        where: { id: workProduct.id },
        data: {
          deliveryStatus: "DELIVERY_FAILED",
          deliveryResult: result as unknown as Prisma.JsonObject,
        },
      });
      // Execution stays in DELIVERING — retryable
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Delivery adapter threw an error";

    await prisma.executionStep.create({
      data: {
        executionId,
        stepIndex: stepCount,
        type: "DELIVERY_ATTEMPT",
        action: `deliver_via_${adapter.slug}`,
        description: `Delivery error: ${errorMsg}`,
        status: "FAILED",
        error: errorMsg,
        completedAt: new Date(),
      },
    });

    await prisma.workProduct.update({
      where: { id: workProduct.id },
      data: {
        deliveryStatus: "DELIVERY_FAILED",
        deliveryResult: { success: false, error: errorMsg } as unknown as Prisma.JsonObject,
      },
    });

    throw error;
  }
}

// ── Queries ───────────────────────────────────────────────

export async function getExecution(id: string) {
  const execution = await prisma.taskExecution.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { stepIndex: "asc" } },
      task: { include: { tactic: { select: { id: true, name: true, category: true } } } },
      workProducts: { orderBy: { version: "desc" } },
    },
  });
  if (!execution) throw new NotFoundError("TaskExecution", id);
  return execution;
}

export async function listExecutions(taskId: string) {
  return prisma.taskExecution.findMany({
    where: { taskId },
    include: { _count: { select: { steps: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listPendingApprovals(userId?: string) {
  return prisma.taskExecution.findMany({
    where: { status: "AWAITING_APPROVAL" },
    include: {
      task: {
        include: {
          tactic: { include: { project: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

// ── Review Queue ─────────────────────────────────────────

/**
 * List work products pending review for a given project, ordered FIFO.
 * Supports cursor-based pagination keyed on work product ID.
 */
export async function listReviewQueue(
  projectSlug: string,
  cursor?: string,
  limit: number = 20,
  filter: "pending" | "all" = "pending",
) {
  const where: Prisma.WorkProductWhereInput = {
    ...(filter === "pending" ? { reviewStatus: "PENDING_REVIEW" } : {}),
    execution: {
      task: {
        tactic: {
          project: { slug: projectSlug },
        },
      },
    },
  };

  const totalCount = await prisma.workProduct.count({ where });

  const items = await prisma.workProduct.findMany({
    where,
    orderBy: { createdAt: filter === "pending" ? "asc" : "desc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      execution: {
        select: {
          id: true,
          status: true,
          taskId: true,
          task: {
            select: {
              id: true,
              title: true,
              tactic: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
      mediaAttachments: {
        orderBy: { sortOrder: "asc" },
        include: {
          mediaAsset: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              thumbnailUrl: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const nextCursor = items.length === limit ? items[items.length - 1].id : null;

  return { items, nextCursor, totalCount };
}

/**
 * Count of work products pending review for a project (for badge display).
 */
export async function getReviewQueueCount(projectSlug: string): Promise<number> {
  return prisma.workProduct.count({
    where: {
      reviewStatus: "PENDING_REVIEW",
      execution: {
        task: {
          tactic: {
            project: { slug: projectSlug },
          },
        },
      },
    },
  });
}

// ── Internal: Context Building ────────────────────────────

export async function buildAgentContext(
  task: any, // Task with tactic + project included
  execution?: any, // TaskExecution record (optional — for work product context)
  preResolvedAgentDef?: AgentDefinition, // Pre-resolved gnome/agent definition
): Promise<AgentContext> {
  // Get recent metrics for this tactic
  const recentMetrics = await prisma.tacticMetric.findMany({
    where: { tacticId: task.tacticId },
    orderBy: { recordedAt: "desc" },
    take: 50,
  });

  // Resolve available tools from MetricsConfig. Phase 5 moved the
  // credential-loading loop into `metrics-config.service.loadProjectCredentials`
  // so the legacy and Managed Agents paths share one implementation.
  const project = task.tactic.project;
  const credentialsMap = await loadProjectCredentials(
    project.id,
    project.organizationId,
  );

  // Use pre-resolved gnome definition for tool providers (falls back to old registry)
  const agentDef = preResolvedAgentDef ?? getAgentDefinition(task.tactic.category);
  const toolProviders = agentDef?.toolProviders ?? [];
  const availableTools = resolveToolsFromCredentials(toolProviders, credentialsMap);

  // Previous executions
  const previousExecutions = await prisma.taskExecution.findMany({
    where: { taskId: task.id, status: { in: ["COMPLETED", "FAILED", "REJECTED"] } },
    select: { id: true, status: true, outputText: true, error: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  // Build the project knowledge block from documents
  const knowledgeBlock = await buildKnowledgeBlock(project.id);

  // ── Work product context ──
  // If this execution targets a work product type, include the schema
  // so the agent knows what structured output to produce.
  let targetWorkProductSchema = undefined;
  let previousWorkProduct = undefined;

  const wpType = execution?.workProductType;
  if (wpType) {
    const wpDef = getWorkProductDefinition(wpType);
    if (wpDef) {
      targetWorkProductSchema = wpDef.dataSchema;
    }

    // If this is a revision, include the previous work product + reviewer feedback
    if (execution?.status === "REVISION_REQUESTED" || execution?.status === "PRODUCING") {
      const prevWp = await prisma.workProduct.findFirst({
        where: { executionId: execution.id },
        orderBy: { version: "desc" },
      });
      if (prevWp?.reviewerNotes) {
        previousWorkProduct = {
          version: prevWp.version,
          data: prevWp.data as Record<string, unknown>,
          reviewerNotes: prevWp.reviewerNotes,
          reviewerEdits: prevWp.reviewerEdits as Record<string, unknown> | undefined,
        };
      }
    }
  }

  // ── Source work product context (task bump) ──
  let sourceWorkProduct = undefined;
  if (task.sourceWorkProductId) {
    const sourceWp = await prisma.workProduct.findUnique({
      where: { id: task.sourceWorkProductId },
      select: {
        id: true,
        definitionSlug: true,
        version: true,
        data: true,
        agentNotes: true,
        execution: {
          select: {
            task: { select: { title: true } },
          },
        },
      },
    });
    if (sourceWp) {
      sourceWorkProduct = {
        id: sourceWp.id,
        definitionSlug: sourceWp.definitionSlug,
        version: sourceWp.version,
        data: sourceWp.data as Record<string, unknown>,
        agentNotes: sourceWp.agentNotes,
        sourceTaskTitle: sourceWp.execution.task.title,
      };
    }
  }

  return {
    task,
    tactic: task.tactic,
    recentMetrics,
    availableTools,
    previousExecutions,
    knowledgeBlock,
    configOverrides: task.agentConfig as Record<string, unknown> | undefined,
    targetWorkProductSchema,
    previousWorkProduct,
    producibleWorkProducts: agentDef?.producibleWorkProducts,
    sourceWorkProduct,
    execution: execution ? {
      id: execution.id,
      workProductType: execution.workProductType,
    } : undefined,
  };
}

// ── Internal: Anthropic Client ────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, MessageParam, ToolUseBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

export async function getAnthropicClient(organizationId: string): Promise<Anthropic> {
  const { getDecryptedApiKey } = await import("./api-key.service");
  const apiKey = await getDecryptedApiKey(organizationId, "ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new ValidationError(
      "ANTHROPIC_API_KEY not configured. Add it in your organization's API Keys settings."
    );
  }
  return new Anthropic({ apiKey });
}

// ── Internal: LLM Calls ───────────────────────────────────

/**
 * Build the user prompt for plan generation.
 * This tells Claude what we need: a structured JSON plan.
 */
function buildPlanPrompt(context: AgentContext, agentDef?: { planPromptSuffix?: string }): string {
  const previousContext = context.previousExecutions.length > 0
    ? `\n\nPrevious attempts:\n${context.previousExecutions.map((e) =>
        `- ${e.status}: ${e.outputText || e.error || "no details"}`
      ).join("\n")}`
    : "";

  const workProductInstruction = context.targetWorkProductSchema
    ? `\n\nThis task should produce a structured work product. Include a "workProductType" field in your plan JSON to declare the type you will produce. The target schema is:\n${JSON.stringify(context.targetWorkProductSchema, null, 2)}`
    : context.producibleWorkProducts?.length
      ? `\n\nThis agent can produce structured work products of the following types: ${context.producibleWorkProducts.join(", ")}. If this task should produce a work product, include a "workProductType" field in your plan JSON with the appropriate type slug.`
      : "";

  const showWpField = !!(context.targetWorkProductSchema || context.producibleWorkProducts?.length);

  return `Create an execution plan for the following task.${previousContext}${workProductInstruction}

Respond with a JSON object in exactly this format (no markdown fences, just raw JSON):
{
  "summary": "Brief description of the overall plan",
  "reasoning": "Why this approach makes sense",
  "steps": [
    {
      "action": "snake_case_action_name",
      "description": "What this step does",
      "tool": "tool_name_if_applicable_or_null",
      "hasSideEffects": false,
      "requiresApproval": false
    }
  ],
  "requiresApproval": true,
  "estimatedDurationMs": 30000${showWpField ? ',\n  "workProductType": "the-work-product-type-slug"' : ""}
}

Rules:
- Mark hasSideEffects: true for any step that writes, posts, publishes, or modifies external data
- Mark requiresApproval: true on the plan if ANY step has side effects
- Only reference tools from the Available Tools list in your system prompt
- Keep the plan focused and actionable — typically 2-6 steps
- Consider the project knowledge base for voice, audience, and brand alignment${agentDef?.planPromptSuffix ?? ""}`;
}

/**
 * Parse Claude's response into an ExecutionPlan.
 * Handles cases where Claude wraps JSON in markdown fences.
 */
function parsePlanResponse(text: string): ExecutionPlan {
  // Strip markdown fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || "No summary provided",
      steps: (parsed.steps || []).map((s: Record<string, unknown>) => ({
        action: s.action || "unknown",
        description: s.description || "",
        tool: s.tool || undefined,
        hasSideEffects: Boolean(s.hasSideEffects),
        requiresApproval: Boolean(s.requiresApproval),
      })),
      requiresApproval: Boolean(parsed.requiresApproval),
      estimatedDurationMs: parsed.estimatedDurationMs,
      reasoning: parsed.reasoning,
      workProductType: parsed.workProductType || undefined,
    };
  } catch {
    // If JSON parsing fails, build a minimal plan from the text
    return {
      summary: text.slice(0, 200),
      steps: [{
        action: "execute_task",
        description: text.slice(0, 500),
        hasSideEffects: false,
        requiresApproval: false,
      }],
      requiresApproval: false,
      reasoning: "Plan was generated as free text — could not parse structured JSON.",
    };
  }
}

/**
 * Generate an execution plan by calling the Anthropic API.
 */
async function callLLMForPlan(
  agentDef: ReturnType<typeof getAgentDefinition> & {},
  context: AgentContext,
  organizationId: string,
): Promise<ExecutionPlan> {
  const client = await getAnthropicClient(organizationId);

  const response = await client.messages.create({
    model: agentDef.defaultModel,
    max_tokens: agentDef.maxPlanTokens,
    system: agentDef.buildSystemPrompt(context),
    messages: [{ role: "user", content: buildPlanPrompt(context, agentDef) }],
  });

  // Extract text from the response
  const textBlock = response.content.find((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text");
  const planText = textBlock?.text || "";

  return parsePlanResponse(planText);
}

/**
 * Map a tool call action to a StepResult type.
 */
function inferStepType(toolName: string): StepResult["type"] {
  if (toolName.includes("read") || toolName.includes("fetch") || toolName.includes("search")) return "DATA_FETCH";
  if (toolName.includes("generate") || toolName.includes("content") || toolName.includes("draft")) return "CONTENT_GEN";
  if (toolName.includes("analyze") || toolName.includes("metric")) return "LLM_REASONING";
  if (toolName.includes("post") || toolName.includes("send") || toolName.includes("publish")) return "TOOL_CALL";
  return "TOOL_CALL";
}

/**
 * Execute an approved plan via the Anthropic API with a tool-use loop.
 *
 * Flow:
 * 1. Send the plan + context to Claude with tools available
 * 2. Claude responds with text and/or tool_use blocks
 * 3. For each tool_use, execute the tool and return results
 * 4. Loop until Claude responds with only text (end_turn)
 * 5. Extract the final output and compile telemetry
 */
export async function callLLMForExecution(
  agentDef: ReturnType<typeof getAgentDefinition> & {},
  context: AgentContext,
  plan: ExecutionPlan,
  organizationId: string,
): Promise<ExecutionResult> {
  const client = await getAnthropicClient(organizationId);
  const startTime = Date.now();

  // Build the tool definitions for the API
  const tools: Anthropic.Tool[] = context.availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
  }));

  // Build the execution prompt
  const hasWorkProduct = !!context.targetWorkProductSchema;

  // When a work product is expected, inject a submit_work_product tool.
  // Tool use is far more reliable than asking the LLM to output structured
  // JSON in free text — Claude naturally produces valid JSON for tool inputs.
  if (hasWorkProduct && context.targetWorkProductSchema) {
    tools.push({
      name: "submit_work_product",
      description:
        "Submit the final structured work product for review. You MUST call this tool " +
        "exactly once after completing all analysis. The input must contain the deliverable " +
        "content (e.g. the actual post text, hashtags, URLs) — not analysis or commentary.",
      input_schema: context.targetWorkProductSchema as Anthropic.Tool["input_schema"],
    });
  }

  const revisionContext = context.previousWorkProduct
    ? `\n\nREVISION CONTEXT: You are revising a previous version (v${context.previousWorkProduct.version}) of this work product.

Reviewer feedback: ${context.previousWorkProduct.reviewerNotes}
${context.previousWorkProduct.reviewerEdits ? `Reviewer edits: ${JSON.stringify(context.previousWorkProduct.reviewerEdits, null, 2)}` : ""}

Previous version data:
${JSON.stringify(context.previousWorkProduct.data, null, 2)}

Address the reviewer's feedback while preserving what worked in the previous version.`
    : "";

  const workProductInstruction = hasWorkProduct
    ? `\n\nIMPORTANT — WORK PRODUCT DELIVERY:
After completing all steps and analysis, you MUST call the submit_work_product tool exactly once to deliver your structured output. This tool call is REQUIRED — the task will fail without it.

Rules for submit_work_product:
- The "body" field must contain the actual deliverable content (the post text itself, not analysis or commentary)
- Hashtags go in the hashtags array WITHOUT the # symbol
- Include ctaUrl, imageRef, postingTime, and notes fields
- Do NOT put analysis or validation in the body — only the content that will be published`
    : "";

  const executionPrompt = `Execute the following approved plan step by step.

Plan: ${plan.summary}

Steps:
${plan.steps.map((s, i) => `${i + 1}. [${s.action}] ${s.description}${s.tool ? ` (using ${s.tool})` : ""}`).join("\n")}

Execute each step using the available tools. After completing all steps, provide a final summary of what was accomplished, any important findings, and recommended next actions.

Important: Use the project knowledge base to ensure all generated content matches the brand voice and guidelines.${workProductInstruction}${revisionContext}`;

  // Conversation loop
  const messages: MessageParam[] = [{ role: "user", content: executionPrompt }];
  const steps: StepResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;
  let finalText = "";
  let capturedWorkProduct: Record<string, unknown> | undefined;

  // Build a map for quick tool lookup
  const toolMap = new Map(context.availableTools.map((t) => [t.name, t]));

  const MAX_TURNS = 20; // safety limit to prevent infinite loops

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: agentDef.defaultModel,
      max_tokens: agentDef.maxExecuteTokens,
      system: agentDef.buildSystemPrompt(context),
      tools,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Collect text blocks from this turn
    const textBlocks = response.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text);

    if (textBlocks.length > 0) {
      finalText = textBlocks.join("\n");
    }

    // Check for tool use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      // Record any final reasoning as a step
      if (finalText && steps.length > 0) {
        steps.push({
          stepIndex: steps.length,
          type: "REPORT",
          action: "final_summary",
          description: "Compiled final report",
          llmResponse: finalText,
          status: "COMPLETED",
          durationMs: Date.now() - startTime,
        });
      }
      break;
    }

    // Add the assistant's response to the conversation
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool call
    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const stepStart = Date.now();
      toolCallCount++;

      const stepIndex = steps.length;

      // Intercept submit_work_product — capture structured data via tool use
      if (toolUse.name === "submit_work_product") {
        capturedWorkProduct = toolUse.input as Record<string, unknown>;
        steps.push({
          stepIndex,
          type: "WORK_PRODUCT_CREATED",
          action: "submit_work_product",
          description: "Submitted structured work product for review",
          tool: "submit_work_product",
          toolInput: capturedWorkProduct,
          toolOutput: { accepted: true },
          status: "COMPLETED",
          durationMs: Date.now() - stepStart,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Work product accepted and queued for review. Provide your final summary.",
        });
        continue;
      }

      const tool = toolMap.get(toolUse.name);

      if (!tool) {
        // Tool not found — return error to Claude
        const errorMsg = `Tool "${toolUse.name}" is not available.`;
        steps.push({
          stepIndex,
          type: "TOOL_CALL",
          action: toolUse.name,
          description: `Attempted to call unknown tool: ${toolUse.name}`,
          toolInput: toolUse.input as Record<string, unknown>,
          status: "FAILED",
          error: errorMsg,
          durationMs: Date.now() - stepStart,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: errorMsg,
          is_error: true,
        });
        continue;
      }

      try {
        // Execute the tool with its credentials
        const credEntry = Array.from(
          (await prisma.metricsConfig.findMany({
            where: { enabled: true },
          }))
        );

        const output = await tool.execute(
          toolUse.input as Record<string, unknown>,
        );

        const outputStr = typeof output === "string" ? output : JSON.stringify(output);

        steps.push({
          stepIndex,
          type: inferStepType(toolUse.name),
          action: toolUse.name,
          description: `Called ${toolUse.name}`,
          tool: toolUse.name,
          toolInput: toolUse.input as Record<string, unknown>,
          toolOutput: output as Record<string, unknown>,
          status: "COMPLETED",
          durationMs: Date.now() - stepStart,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: outputStr,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Tool execution failed";
        steps.push({
          stepIndex,
          type: inferStepType(toolUse.name),
          action: toolUse.name,
          tool: toolUse.name,
          toolInput: toolUse.input as Record<string, unknown>,
          status: "FAILED",
          error: errorMsg,
          durationMs: Date.now() - stepStart,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });
      }
    }

    // Feed tool results back to Claude
    messages.push({ role: "user", content: toolResults });
  }

  const durationMs = Date.now() - startTime;
  const allSucceeded = steps.every((s) => s.status !== "FAILED");

  // Resolve work product data:
  // 1. Prefer data captured via submit_work_product tool call (most reliable)
  // 2. Fall back to extracting from <work_product> tags in free text
  // 3. Fall back to JSON extraction heuristics
  let workProductData: Record<string, unknown> | undefined = capturedWorkProduct;

  if (!workProductData && context.targetWorkProductSchema) {
    workProductData = extractWorkProductData(finalText);
  }

  return {
    success: allSucceeded,
    output: {
      summary: finalText.slice(0, 500),
      stepsCompleted: steps.filter((s) => s.status === "COMPLETED").length,
      stepsFailed: steps.filter((s) => s.status === "FAILED").length,
    },
    outputText: finalText,
    steps,
    telemetry: {
      model: agentDef.defaultModel,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      durationMs,
      toolCalls: toolCallCount,
    },
    workProductData,
  };
}

/**
 * Extract structured work product JSON from the agent's final text output.
 * Looks for content wrapped in <work_product>...</work_product> tags.
 * Falls back to finding the last JSON object in the text.
 */
function extractWorkProductData(text: string): Record<string, unknown> | undefined {
  // Try <work_product> tags first (preferred format)
  const tagMatch = text.match(/<work_product>\s*([\s\S]*?)\s*<\/work_product>/);
  if (tagMatch) {
    try {
      return JSON.parse(tagMatch[1]);
    } catch {
      // Tag found but invalid JSON — fall through
    }
  }

  // Fallback: find the last ```json ... ``` block
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g)];
  if (fenceMatches.length > 0) {
    const lastFence = fenceMatches[fenceMatches.length - 1];
    try {
      return JSON.parse(lastFence[1]);
    } catch {
      // Invalid JSON in fence — fall through
    }
  }

  // Last resort: try to find a top-level JSON object at the end of the text
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace !== -1) {
    // Walk backward to find the matching opening brace
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      if (text[i] === "{") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, lastBrace + 1));
        } catch {
          break;
        }
      }
    }
  }

  return undefined;
}
