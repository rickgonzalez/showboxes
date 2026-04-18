import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type {
  AnalysisJSON,
  AnalysisRecord,
} from '@showboxes/shared-types';
import { canReadAnalysis, getOptionalUser } from '@/lib/access';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: Params) {
  const { id } = await ctx.params;

  const row = await prisma.analysis.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const user = await getOptionalUser(req);
  const decision = canReadAnalysis(row, { user });
  if (!decision.ok) {
    const status =
      decision.reason === 'unauthorized'
        ? 401
        : decision.reason === 'forbidden'
          ? 403
          : 404;
    return NextResponse.json({ error: decision.reason }, { status });
  }

  const record: AnalysisRecord = {
    id: row.id,
    repoUrl: row.repoUrl,
    commitSha: row.commitSha,
    status: (row.status as AnalysisRecord['status']) ?? 'running',
    agentVersion: row.agentVersion ?? null,
    data: (row.data as unknown as AnalysisJSON | null) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return NextResponse.json(record);
}
