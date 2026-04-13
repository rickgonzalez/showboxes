import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors";
import type { TacticCategory, Prisma, Gnome } from "@prisma/client";
import { getAllBuiltInGnomes, getBuiltInGnome } from "@/agents/defaults";
import type { BuiltInGnomeData } from "@/agents/defaults";
import { syncGnomeToManagedAgent } from "@/agents/managed-agents/sync";

// ── Types ────────────────────────────────────────────────

export interface CreateGnomeInput {
  projectSlug?: string;
  organizationSlug?: string;
  name: string;
  slug?: string;
  description: string;
  icon?: string;
  categories: TacticCategory[];
  defaultModel?: string;
  maxPlanTokens?: number;
  maxExecuteTokens?: number;
  canAutoExecute?: boolean;
  systemPromptTemplate: string;
  toolProviders?: string[];
  producibleWorkProducts?: string[];
}

export interface UpdateGnomeInput {
  name?: string;
  description?: string;
  icon?: string;
  categories?: TacticCategory[];
  defaultModel?: string;
  maxPlanTokens?: number;
  maxExecuteTokens?: number;
  canAutoExecute?: boolean;
  systemPromptTemplate?: string;
  toolProviders?: string[];
  producibleWorkProducts?: string[];
  lastEditedBy?: string;
}

export interface ListGnomesFilter {
  projectSlug?: string;
  organizationSlug?: string;
  category?: TacticCategory;
}

// ── Slug Generation ──────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// ── Resolve Scope ────────────────────────────────────────

async function resolveScope(projectSlug?: string, organizationSlug?: string) {
  if (!projectSlug && !organizationSlug) {
    throw new ValidationError("Either projectSlug or organizationSlug is required");
  }

  let projectId: string | undefined;
  let organizationId: string | undefined;

  if (projectSlug) {
    const project = await prisma.project.findFirst({ where: { slug: projectSlug } });
    if (!project) throw new NotFoundError("Project", projectSlug);
    projectId = project.id;
  }

  if (organizationSlug) {
    const org = await prisma.organization.findUnique({ where: { slug: organizationSlug } });
    if (!org) throw new NotFoundError("Organization", organizationSlug);
    organizationId = org.id;
  }

  return { projectId, organizationId };
}

// ── Create ───────────────────────────────────────────────

export async function createGnome(input: CreateGnomeInput) {
  const { projectId, organizationId } = await resolveScope(input.projectSlug, input.organizationSlug);
  const slug = input.slug || generateSlug(input.name);

  const existing = await prisma.gnome.findFirst({
    where: {
      slug,
      ...(projectId ? { projectId } : {}),
      ...(organizationId ? { organizationId } : {}),
    },
  });
  if (existing) {
    throw new ConflictError(`Gnome with slug "${slug}" already exists in this scope`);
  }

  const created = await prisma.gnome.create({
    data: {
      projectId: projectId ?? null,
      organizationId: organizationId ?? null,
      name: input.name,
      slug,
      description: input.description,
      icon: input.icon,
      categories: input.categories,
      defaultModel: input.defaultModel ?? "claude-sonnet-4-20250514",
      maxPlanTokens: input.maxPlanTokens ?? 2048,
      maxExecuteTokens: input.maxExecuteTokens ?? 4096,
      canAutoExecute: input.canAutoExecute ?? false,
      systemPromptTemplate: input.systemPromptTemplate,
      toolProviders: input.toolProviders ?? [],
      producibleWorkProducts: input.producibleWorkProducts ?? [],
    },
  });

  // Phase 1: mirror this gnome as a remote Managed Agents Agent. The helper
  // never throws — failures are captured in `externalAgentError` so gnome
  // editing stays decoupled from beta uptime. Reload to surface the new
  // external columns to the caller.
  await syncGnomeToManagedAgent(created.id);
  return prisma.gnome.findUniqueOrThrow({ where: { id: created.id } });
}

// ── Read ─────────────────────────────────────────────────

export async function getGnome(id: string) {
  const gnome = await prisma.gnome.findUnique({ where: { id } });
  if (!gnome) throw new NotFoundError("Gnome", id);
  return gnome;
}

export async function getGnomeBySlug(scope: { projectSlug?: string; organizationSlug?: string }, slug: string) {
  const { projectId, organizationId } = await resolveScope(scope.projectSlug, scope.organizationSlug);

  const gnome = await prisma.gnome.findFirst({
    where: {
      slug,
      ...(projectId ? { projectId } : {}),
      ...(organizationId ? { organizationId } : {}),
    },
  });
  if (!gnome) throw new NotFoundError("Gnome", slug);
  return gnome;
}

// ── List ─────────────────────────────────────────────────

export async function listGnomes(filter: ListGnomesFilter) {
  const { projectId, organizationId } = await resolveScope(filter.projectSlug, filter.organizationSlug);

  const where: Prisma.GnomeWhereInput = {
    ...(projectId ? { projectId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(filter.category ? { categories: { has: filter.category } } : {}),
  };

  return prisma.gnome.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
  });
}

// ── Update ───────────────────────────────────────────────

export async function updateGnome(id: string, input: UpdateGnomeInput) {
  const existing = await prisma.gnome.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Gnome", id);

  await prisma.gnome.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.categories !== undefined ? { categories: input.categories } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      ...(input.maxPlanTokens !== undefined ? { maxPlanTokens: input.maxPlanTokens } : {}),
      ...(input.maxExecuteTokens !== undefined ? { maxExecuteTokens: input.maxExecuteTokens } : {}),
      ...(input.canAutoExecute !== undefined ? { canAutoExecute: input.canAutoExecute } : {}),
      ...(input.systemPromptTemplate !== undefined ? { systemPromptTemplate: input.systemPromptTemplate } : {}),
      ...(input.toolProviders !== undefined ? { toolProviders: input.toolProviders } : {}),
      ...(input.producibleWorkProducts !== undefined ? { producibleWorkProducts: input.producibleWorkProducts } : {}),
      ...(input.lastEditedBy !== undefined ? { lastEditedBy: input.lastEditedBy } : {}),
      version: { increment: 1 },
    },
  });

  // Phase 1: push the change to the remote Managed Agents Agent. Helper
  // never throws — failures land in `externalAgentError`. Reload after sync
  // so the caller sees the bumped externalAgentVersion / syncedAt.
  await syncGnomeToManagedAgent(id);
  return prisma.gnome.findUniqueOrThrow({ where: { id } });
}

// ── Delete ───────────────────────────────────────────────

export async function deleteGnome(id: string) {
  const existing = await prisma.gnome.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Gnome", id);

  await prisma.gnome.delete({ where: { id } });
  return { deleted: true, id };
}

// ── Effective Gnomes (Merges DB + Built-in Defaults) ─────

/**
 * Virtual gnome record: either a real DB Gnome or a BuiltInGnomeData
 * presented with a consistent shape for the UI and resolution layer.
 */
export type EffectiveGnome = {
  /** cuid for DB records, `builtin:${slug}` for virtual defaults */
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  categories: TacticCategory[];
  defaultModel: string;
  maxPlanTokens: number;
  maxExecuteTokens: number;
  canAutoExecute: boolean;
  systemPromptTemplate: string;
  toolProviders: string[];
  producibleWorkProducts: string[];
  isBuiltIn: boolean;
  builtInSlug: string | null;
  version: number;
  /** true if this is a virtual entry from code defaults (no DB row) */
  isVirtual: boolean;
};

function dbGnomeToEffective(gnome: Gnome): EffectiveGnome {
  return {
    id: gnome.id,
    slug: gnome.slug,
    name: gnome.name,
    description: gnome.description,
    icon: gnome.icon,
    categories: gnome.categories,
    defaultModel: gnome.defaultModel,
    maxPlanTokens: gnome.maxPlanTokens,
    maxExecuteTokens: gnome.maxExecuteTokens,
    canAutoExecute: gnome.canAutoExecute,
    systemPromptTemplate: gnome.systemPromptTemplate,
    toolProviders: gnome.toolProviders,
    producibleWorkProducts: gnome.producibleWorkProducts,
    isBuiltIn: gnome.isBuiltIn,
    builtInSlug: gnome.builtInSlug,
    version: gnome.version,
    isVirtual: false,
  };
}

function builtInToEffective(gnome: BuiltInGnomeData): EffectiveGnome {
  return {
    id: `builtin:${gnome.slug}`,
    slug: gnome.slug,
    name: gnome.name,
    description: gnome.description,
    icon: gnome.icon,
    categories: gnome.categories,
    defaultModel: gnome.defaultModel,
    maxPlanTokens: gnome.maxPlanTokens,
    maxExecuteTokens: gnome.maxExecuteTokens,
    canAutoExecute: gnome.canAutoExecute,
    systemPromptTemplate: gnome.systemPromptTemplate,
    toolProviders: gnome.toolProviders,
    producibleWorkProducts: gnome.producibleWorkProducts,
    isBuiltIn: true,
    builtInSlug: gnome.slug,
    version: 0,
    isVirtual: true,
  };
}

/**
 * Get all effective gnomes for a project. Merges:
 * 1. Project-level DB gnomes (highest precedence)
 * 2. Org-level DB gnomes (if project belongs to an org)
 * 3. Built-in code defaults (lowest precedence)
 *
 * De-duplicated by slug: project > org > built-in.
 */
export async function getEffectiveGnomes(projectId: string): Promise<EffectiveGnome[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true },
  });
  if (!project) throw new NotFoundError("Project", projectId);

  // Fetch project-level gnomes
  const projectGnomes = await prisma.gnome.findMany({
    where: { projectId: project.id },
    orderBy: { updatedAt: "desc" },
  });

  // Fetch org-level gnomes
  let orgGnomes: Awaited<ReturnType<typeof prisma.gnome.findMany>> = [];
  if (project.organizationId) {
    orgGnomes = await prisma.gnome.findMany({
      where: { organizationId: project.organizationId, projectId: null },
      orderBy: { updatedAt: "desc" },
    });
  }

  // Merge: project > org > built-in
  const seenSlugs = new Set<string>();
  const result: EffectiveGnome[] = [];

  for (const g of projectGnomes) {
    seenSlugs.add(g.slug);
    result.push(dbGnomeToEffective(g));
  }

  for (const g of orgGnomes) {
    if (!seenSlugs.has(g.slug)) {
      seenSlugs.add(g.slug);
      result.push(dbGnomeToEffective(g));
    }
  }

  // Add built-in defaults that haven't been shadowed
  for (const builtIn of getAllBuiltInGnomes()) {
    if (!seenSlugs.has(builtIn.slug)) {
      seenSlugs.add(builtIn.slug);
      result.push(builtInToEffective(builtIn));
    }
  }

  return result;
}

/**
 * Resolve the gnome that should handle a given tactic category.
 * Returns the first effective gnome whose categories include the target.
 */
export async function resolveGnomeForCategory(
  projectId: string,
  category: TacticCategory,
): Promise<EffectiveGnome | undefined> {
  const all = await getEffectiveGnomes(projectId);
  return all.find((g) => g.categories.includes(category));
}

/**
 * Resolve a gnome by slug (regardless of tactic category).
 * Used when a task has been explicitly assigned to a specific gnome
 * (e.g. designer-gnome assigned by the social-media gnome via
 * request_media_design tool).
 */
export async function resolveGnomeBySlug(
  projectId: string,
  slug: string,
): Promise<EffectiveGnome | undefined> {
  const all = await getEffectiveGnomes(projectId);
  return all.find((g) => g.slug === slug);
}

// ── Copy-on-Write for Built-in Editing ───────────────────

/**
 * Create a project-level DB copy of a built-in gnome (copy-on-write).
 * Called when a user edits a virtual built-in for the first time.
 */
export async function copyBuiltInToProject(
  builtInSlug: string,
  projectSlug: string,
  overrides: UpdateGnomeInput,
): Promise<Gnome> {
  const builtIn = getBuiltInGnome(builtInSlug);
  if (!builtIn) throw new NotFoundError("Built-in Gnome", builtInSlug);

  const { projectId } = await resolveScope(projectSlug);
  if (!projectId) throw new ValidationError("projectSlug is required");

  // Check if a copy already exists
  const existing = await prisma.gnome.findFirst({
    where: { projectId, slug: builtIn.slug },
  });
  if (existing) {
    throw new ConflictError(`A gnome with slug "${builtIn.slug}" already exists in this project`);
  }

  return prisma.gnome.create({
    data: {
      projectId,
      name: overrides.name ?? builtIn.name,
      slug: builtIn.slug,
      description: overrides.description ?? builtIn.description,
      icon: overrides.icon ?? builtIn.icon,
      categories: overrides.categories ?? builtIn.categories,
      defaultModel: overrides.defaultModel ?? builtIn.defaultModel,
      maxPlanTokens: overrides.maxPlanTokens ?? builtIn.maxPlanTokens,
      maxExecuteTokens: overrides.maxExecuteTokens ?? builtIn.maxExecuteTokens,
      canAutoExecute: overrides.canAutoExecute ?? builtIn.canAutoExecute,
      systemPromptTemplate: overrides.systemPromptTemplate ?? builtIn.systemPromptTemplate,
      toolProviders: overrides.toolProviders ?? builtIn.toolProviders,
      producibleWorkProducts: overrides.producibleWorkProducts ?? builtIn.producibleWorkProducts,
      isBuiltIn: true,
      builtInSlug: builtIn.slug,
      lastEditedBy: overrides.lastEditedBy,
    },
  });
}

/**
 * Reset a customized built-in gnome back to its canonical defaults.
 */
export async function resetGnomeToDefault(id: string) {
  const gnome = await prisma.gnome.findUnique({ where: { id } });
  if (!gnome) throw new NotFoundError("Gnome", id);
  if (!gnome.builtInSlug) throw new ValidationError("This gnome is not a customized built-in");

  const builtIn = getBuiltInGnome(gnome.builtInSlug);
  if (!builtIn) throw new NotFoundError("Built-in Gnome", gnome.builtInSlug);

  return prisma.gnome.update({
    where: { id },
    data: {
      name: builtIn.name,
      description: builtIn.description,
      icon: builtIn.icon,
      categories: builtIn.categories,
      defaultModel: builtIn.defaultModel,
      maxPlanTokens: builtIn.maxPlanTokens,
      maxExecuteTokens: builtIn.maxExecuteTokens,
      canAutoExecute: builtIn.canAutoExecute,
      systemPromptTemplate: builtIn.systemPromptTemplate,
      toolProviders: builtIn.toolProviders,
      producibleWorkProducts: builtIn.producibleWorkProducts,
      version: { increment: 1 },
    },
  });
}
