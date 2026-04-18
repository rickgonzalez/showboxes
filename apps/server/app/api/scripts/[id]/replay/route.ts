import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { PresentationScript } from '@showboxes/shared-types';
import {
  canReadScript,
  extractShareToken,
  getOptionalUser,
} from '@/lib/access';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Replay endpoint — returns the raw PresentationScript for a saved
 * script id, stripped of persistence metadata. Intended for headless /
 * programmatic playback where the caller just wants the script blob
 * to hand to the ScriptPlayer.
 *
 * GET and POST are both accepted so it can be used from either a link
 * or a form/fetch call.
 */
export async function GET(req: Request, ctx: Params) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: Params) {
  return handle(req, ctx);
}

async function handle(req: Request, ctx: Params) {
  const { id } = await ctx.params;

  const row = await prisma.script.findUnique({
    where: { id },
    select: {
      status: true,
      data: true,
      error: true,
      userId: true,
      visibility: true,
      shareToken: true,
    },
  });
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

  if (row.status !== 'ready' || !row.data) {
    return NextResponse.json(
      { error: row.error ?? `script is ${row.status}` },
      { status: 409 },
    );
  }

  return NextResponse.json(row.data as unknown as PresentationScript);
}
