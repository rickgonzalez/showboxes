/**
 * Bootstrap — ensure our Managed Agents environment and the code-analysis
 * gnome exist in Anthropic's beta, mirrored to our own Prisma tables.
 *
 * Called lazily from /api/analyze the first time. Idempotent: safe to
 * call on every request — the DB lookups short-circuit when already
 * provisioned.
 */

import { prisma } from '../prisma';
import {
  managedAgentsApi,
  BETA_QS,
  resolveManagedAgentModel,
  type AgentResponse,
  type EnvironmentResponse,
  type AgentCreateBody,
} from './client';
import { codeAnalysisGnome } from '../agents/code-analysis.gnome';
import { codeTriageGnome } from '../agents/code-triage.gnome';
import { SUBMIT_CODE_ANALYSIS_TOOL } from '../agents/submit-code-analysis.tool';
import { SUBMIT_TRIAGE_TOOL } from '../agents/submit-triage.tool';

const BUILT_IN_TOOLSET = { type: 'agent_toolset_20260401' as const };

export interface ProvisionedAgents {
  environmentExternalId: string;
  codeAnalysisAgentExternalId: string;
  codeTriageAgentExternalId: string;
}

/**
 * Ensure the environment row exists in our DB and mirrors an Anthropic
 * environment. Creates both if missing.
 */
async function ensureEnvironment(): Promise<string> {
  const existing = await prisma.managedAgentEnvironment.findFirst();
  if (existing) return existing.externalId;

  const envName =
    process.env.MANAGED_AGENTS_ENVIRONMENT_SLUG ?? 'showboxes-dev';

  const env = await managedAgentsApi<EnvironmentResponse>(
    'POST',
    `/v1/environments${BETA_QS}`,
    { name: envName },
  );

  if (!env.id) {
    throw new Error(
      `Environment create returned no id (body: ${JSON.stringify(env)})`,
    );
  }

  await prisma.managedAgentEnvironment.create({
    data: { externalId: env.id, name: envName },
  });
  return env.id;
}

/**
 * Ensure the code-analysis gnome is mirrored to an Anthropic agent and
 * our Gnome row has its externalAgentId.
 */
async function ensureCodeAnalysisAgent(): Promise<string> {
  const slug = codeAnalysisGnome.slug;
  const existing = await prisma.gnome.findUnique({ where: { slug } });

  if (existing?.externalAgentId) return existing.externalAgentId;

  // Note: the render step here uses the raw template (with Handlebars
  // placeholders). Anthropic stores it as the agent's `system`; our
  // per-session render happens before sending the first user.message.
  // For now, we send the UNRENDERED template — the per-session prompt
  // will be sent in the user message instead. This keeps provisioning
  // cheap and lets the same agent serve many repos.
  const body: AgentCreateBody = {
    name: codeAnalysisGnome.name,
    model: resolveManagedAgentModel(codeAnalysisGnome.defaultModel),
    system: buildStaticSystem(),
    description: codeAnalysisGnome.description,
    tools: [BUILT_IN_TOOLSET, toCustomToolSpec(SUBMIT_CODE_ANALYSIS_TOOL)],
  };

  const agent = await managedAgentsApi<AgentResponse>(
    'POST',
    `/v1/agents${BETA_QS}`,
    body,
  );

  if (!agent.id) {
    throw new Error(
      `Agent create returned no id (body: ${JSON.stringify(agent)})`,
    );
  }

  await prisma.gnome.upsert({
    where: { slug },
    create: {
      slug,
      name: codeAnalysisGnome.name,
      description: codeAnalysisGnome.description,
      defaultModel: codeAnalysisGnome.defaultModel,
      systemPromptTemplate: codeAnalysisGnome.systemPromptTemplate,
      externalAgentId: agent.id,
      externalAgentVersion: agent.version ?? 1,
    },
    update: {
      externalAgentId: agent.id,
      externalAgentVersion: agent.version ?? 1,
    },
  });

  return agent.id;
}

/**
 * Ensure the code-triage gnome is mirrored to an Anthropic agent.
 * Same pattern as ensureCodeAnalysisAgent — a separate agent with a
 * smaller model and the submit_triage tool only.
 */
async function ensureCodeTriageAgent(): Promise<string> {
  const slug = codeTriageGnome.slug;
  const existing = await prisma.gnome.findUnique({ where: { slug } });

  if (existing?.externalAgentId) return existing.externalAgentId;

  const body: AgentCreateBody = {
    name: codeTriageGnome.name,
    model: resolveManagedAgentModel(codeTriageGnome.defaultModel),
    system: buildTriageStaticSystem(),
    description: codeTriageGnome.description,
    tools: [BUILT_IN_TOOLSET, toCustomToolSpec(SUBMIT_TRIAGE_TOOL)],
  };

  const agent = await managedAgentsApi<AgentResponse>(
    'POST',
    `/v1/agents${BETA_QS}`,
    body,
  );

  if (!agent.id) {
    throw new Error(
      `Triage agent create returned no id (body: ${JSON.stringify(agent)})`,
    );
  }

  await prisma.gnome.upsert({
    where: { slug },
    create: {
      slug,
      name: codeTriageGnome.name,
      description: codeTriageGnome.description,
      defaultModel: codeTriageGnome.defaultModel,
      systemPromptTemplate: codeTriageGnome.systemPromptTemplate,
      externalAgentId: agent.id,
      externalAgentVersion: agent.version ?? 1,
    },
    update: {
      externalAgentId: agent.id,
      externalAgentVersion: agent.version ?? 1,
    },
  });

  return agent.id;
}

/**
 * Provision (or look up) the environment and both agents (triage + analysis).
 * Idempotent — callers can invoke this on every /api/triage or /api/analyze request.
 */
export async function ensureProvisioned(): Promise<ProvisionedAgents> {
  const [envId, analysisAgentId, triageAgentId] = await Promise.all([
    ensureEnvironment(),
    ensureCodeAnalysisAgent(),
    ensureCodeTriageAgent(),
  ]);
  return {
    environmentExternalId: envId,
    codeAnalysisAgentExternalId: analysisAgentId,
    codeTriageAgentExternalId: triageAgentId,
  };
}

// ── helpers ───────────────────────────────────────────────────

/**
 * The static `system` the agent is created with. This is the permanent
 * identity; the per-run repo URL + focus areas get sent as the initial
 * `user.message` by the session driver.
 */
function buildStaticSystem(): string {
  return [
    'You are a Code Analysis Gnome. You analyze GitHub repositories and ',
    'produce structured analyses via the `submit_code_analysis` tool.',
    '',
    'Each run delivers a user message containing the target repo URL and ',
    'optional focus areas. Follow the methodology outlined in that message ',
    'and call `submit_code_analysis` exactly once at the end.',
  ].join('\n');
}

function buildTriageStaticSystem(): string {
  return [
    'You are a Code Triage Gnome. You scout GitHub repositories fast ',
    '(tree + manifests only, no deep source reads) and deliver a short ',
    'TriageReport via the `submit_triage` tool.',
    '',
    'Each run delivers a user message containing the target repo URL. ',
    'Follow the methodology outlined in that message and call ',
    '`submit_triage` exactly once at the end.',
  ].join('\n');
}

function toCustomToolSpec(tool: {
  name: string;
  description: string;
  input_schema: unknown;
}) {
  return {
    type: 'custom',
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}
