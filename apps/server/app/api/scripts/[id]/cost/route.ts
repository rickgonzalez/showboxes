/**
 * GET /api/scripts/:id/cost
 *
 * Returns the cost rollup persisted on Script.usage. Shape is
 * { version, stages[], totals, computedAt } — see lib/costs/rollup.ts.
 *
 * If the Script was created before cost capture landed (or by a code
 * path that didn't write a rollup), returns 404-esque 200 with
 * `{ rollup: null, legacyUsage }` so the caller can distinguish
 * "missing data" from "no rollup needed".
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { CostRollup } from '@/lib/costs/rollup';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Params) {
  const { id } = await ctx.params;

  const row = await prisma.script.findUnique({
    where: { id },
    select: {
      id: true,
      repoUrl: true,
      label: true,
      producerModel: true,
      usage: true,
      createdAt: true,
    },
  });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const usage = row.usage as unknown;

  // Distinguish a full CostRollup (has `version` + `totals`) from the
  // legacy shape ({ inputTokens, outputTokens }) so clients can handle
  // old rows without a guess.
  const isRollup =
    !!usage &&
    typeof usage === 'object' &&
    'version' in (usage as Record<string, unknown>) &&
    'totals' in (usage as Record<string, unknown>);

  if (isRollup) {
    return NextResponse.json({
      scriptId: row.id,
      repoUrl: row.repoUrl,
      label: row.label,
      producerModel: row.producerModel,
      createdAt: row.createdAt.toISOString(),
      rollup: usage as CostRollup,
    });
  }

  return NextResponse.json({
    scriptId: row.id,
    repoUrl: row.repoUrl,
    label: row.label,
    producerModel: row.producerModel,
    createdAt: row.createdAt.toISOString(),
    rollup: null,
    legacyUsage: usage ?? null,
    note: 'Script was created before cost rollup capture was enabled.',
  });
}
