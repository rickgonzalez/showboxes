import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth/session';
import { interruptSession } from '@/lib/agents/session';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/analyze/:id/cancel
 *
 * Flip the Analysis to `cancelling` and best-effort interrupt the Managed
 * Agents session. The running after() block detects the status change and
 * settles against partial costs when runSessionToCompletion throws.
 *
 * Idempotent: hitting this on a non-running Analysis is a 409 but never
 * corrupts state. Ownership checked — another user can't cancel your run.
 */
export async function POST(req: Request, ctx: Params) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.kind }, { status: 401 });
    }
    throw e;
  }

  const { id } = await ctx.params;
  const row = await prisma.analysis.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (row.userId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status !== 'running') {
    return NextResponse.json(
      { error: 'not cancellable', status: row.status },
      { status: 409 },
    );
  }

  await prisma.analysis.update({
    where: { id },
    data: { status: 'cancelling' },
  });

  if (row.sessionId) {
    await interruptSession(row.sessionId);
  }

  return NextResponse.json({ id, status: 'cancelling' }, { status: 202 });
}
