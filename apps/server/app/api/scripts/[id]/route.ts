import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type {
  PresentationScript,
  ScriptRecord,
  ScriptStatus,
} from '@showboxes/shared-types';
import {
  canReadScript,
  extractShareToken,
  getOptionalUser,
} from '@/lib/access';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: Params) {
  const { id } = await ctx.params;

  const row = await prisma.script.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const user = await getOptionalUser(req);
  const decision = canReadScript(row, {
    user,
    providedToken: extractShareToken(req),
  });
  if (!decision.ok) {
    const status =
      decision.reason === 'unauthorized'
        ? 401
        : decision.reason === 'forbidden'
          ? 403
          : 404;
    return NextResponse.json({ error: decision.reason }, { status });
  }

  const record: ScriptRecord = {
    id: row.id,
    analysisId: row.analysisId,
    repoUrl: row.repoUrl,
    commitSha: row.commitSha,
    label: row.label,
    persona: row.persona,
    status: (row.status as ScriptStatus) ?? 'ready',
    data: (row.data as unknown as PresentationScript | null) ?? null,
    focusInstructions: row.focusInstructions,
    producerModel: row.producerModel,
    // Cost signals are internal — only the owner sees them.
    usage: decision.isOwner
      ? ((row.usage as unknown as ScriptRecord['usage']) ?? null)
      : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return NextResponse.json(record);
}
