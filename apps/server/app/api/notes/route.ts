import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

/**
 * /api/notes — capture reviewer notes against a script scene.
 *
 * The player's "flag" button pauses playback and POSTs here with the
 * current scene context. Notes are stored flat in ScriptNote; there's no
 * retrieval endpoint yet — the user queries the DB directly (pgAdmin).
 */

const bodySchema = z.object({
  scriptId: z.string().nullish(),
  scriptLabel: z.string().nullish(),
  analysisId: z.string().nullish(),
  repoUrl: z.string().nullish(),
  sceneIndex: z.number().int().min(0),
  sceneId: z.string(),
  sceneTemplate: z.string(),
  note: z.string().min(1),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid body', detail: (e as Error).message },
      { status: 400 },
    );
  }

  try {
    const saved = await prisma.scriptNote.create({
      data: {
        scriptId: parsed.scriptId ?? null,
        scriptLabel: parsed.scriptLabel ?? null,
        analysisId: parsed.analysisId ?? null,
        repoUrl: parsed.repoUrl ?? null,
        sceneIndex: parsed.sceneIndex,
        sceneId: parsed.sceneId,
        sceneTemplate: parsed.sceneTemplate,
        note: parsed.note,
      },
      select: { id: true, createdAt: true },
    });
    return NextResponse.json(saved);
  } catch (e) {
    console.error('[/api/notes] DB error:', e);
    return NextResponse.json(
      { error: 'DB_ERROR', detail: (e as Error).message },
      { status: 500 },
    );
  }
}
