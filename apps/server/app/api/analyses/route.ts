import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AnalysisStatus, AnalysisSummary } from '@showboxes/shared-types';
import { getOptionalUser } from '@/lib/access';

/**
 * List prior analyses, optionally filtered by repoUrl. Returns
 * summaries only (no `data` blob) so the dropdown payload stays small.
 *
 * Owner-scoped — Analyses are never cross-user discoverable. Anonymous
 * callers get an empty list.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoUrl = url.searchParams.get('repoUrl');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 100);

  const user = await getOptionalUser(req);
  if (!user) {
    return NextResponse.json({ analyses: [] });
  }

  const where: { userId: string; repoUrl?: string } = { userId: user.id };
  if (repoUrl) where.repoUrl = repoUrl;

  const rows = await prisma.analysis.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      repoUrl: true,
      status: true,
      agentVersion: true,
      commitSha: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const summaries: AnalysisSummary[] = rows.map((r) => ({
    id: r.id,
    repoUrl: r.repoUrl,
    status: (r.status as AnalysisStatus) ?? 'running',
    agentVersion: r.agentVersion ?? null,
    commitSha: r.commitSha,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return NextResponse.json({ analyses: summaries });
}
