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
import { AuthError, requireUser } from '@/lib/auth/session';

interface Params {
  params: Promise<{ id: string }>;
}

// Owner-only. Cost data is an internal signal — even holders of a
// valid unlisted shareToken don't see it. See EMBED-AND-AUTH-PLAN
// §Watch-outs ("Don't leak StageCosts on unlisted Scripts").
export async function GET(req: Request, ctx: Params) {
  const { id } = await ctx.params;

  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.kind }, { status: 401 });
    }
    throw e;
  }

  const row = await prisma.script.findUnique({
    where: { id },
    select: {
      id: true,
      repoUrl: true,
      label: true,
      producerModel: true,
      usage: true,
      createdAt: true,
      userId: true,
    },
  });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (row.userId !== user.id) {
    // 404 rather than 403 — don't reveal which ids exist to non-owners.
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
