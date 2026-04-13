import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ScriptStatus, ScriptSummary } from '@showboxes/shared-types';

/**
 * List saved scripts, newest first. Filter by `analysisId` to show the
 * scripts derived from a specific analysis run, or by `repoUrl` to show
 * all saved scripts for a repo across analyses. Returns summaries only
 * (no `data` blob) so the dropdown payload stays small.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const analysisId = url.searchParams.get('analysisId');
  const repoUrl = url.searchParams.get('repoUrl');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const where: { analysisId?: string; repoUrl?: string } = {};
  if (analysisId) where.analysisId = analysisId;
  if (repoUrl) where.repoUrl = repoUrl;

  const rows = await prisma.script.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      analysisId: true,
      repoUrl: true,
      label: true,
      persona: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const summaries: ScriptSummary[] = rows.map((r) => ({
    id: r.id,
    analysisId: r.analysisId,
    repoUrl: r.repoUrl,
    label: r.label,
    persona: r.persona,
    status: (r.status as ScriptStatus) ?? 'ready',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return NextResponse.json({ scripts: summaries });
}
