import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { PresentationScript } from '@showboxes/shared-types';

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
export async function GET(_req: Request, ctx: Params) {
  return handle(ctx);
}

export async function POST(_req: Request, ctx: Params) {
  return handle(ctx);
}

async function handle(ctx: Params) {
  const { id } = await ctx.params;

  const row = await prisma.script.findUnique({
    where: { id },
    select: { status: true, data: true, error: true },
  });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (row.status !== 'ready' || !row.data) {
    return NextResponse.json(
      { error: row.error ?? `script is ${row.status}` },
      { status: 409 },
    );
  }

  return NextResponse.json(row.data as unknown as PresentationScript);
}
