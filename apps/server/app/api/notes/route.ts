import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth/session';

/**
 * /api/notes — capture reviewer notes against a script scene.
 *
 * The player's "flag" button pauses playback and POSTs here with the
 * current scene context. Notes are stored flat in ScriptNote; there's no
 * retrieval endpoint yet — the user queries the DB directly (pgAdmin).
 *
 * Author-only. Notes are an internal tuning tool — the viewer-mode
 * embed does not render the flag button at all. We still enforce
 * auth + owner-match here so the endpoint isn't a spam vector.
 * See EMBED-AND-AUTH-PLAN.md §Access rules.
 */

const bodySchema = z.object({
  scriptId: z.string().min(1),
  scriptLabel: z.string().nullish(),
  analysisId: z.string().nullish(),
  repoUrl: z.string().nullish(),
  sceneIndex: z.number().int().min(0),
  sceneId: z.string(),
  sceneTemplate: z.string(),
  note: z.string().min(1),
  suspectArea: z.enum(['analysis', 'script', 'template']).nullish(),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.kind }, { status: 401 });
    }
    throw e;
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid body', detail: (e as Error).message },
      { status: 400 },
    );
  }

  const script = await prisma.script.findUnique({
    where: { id: parsed.scriptId },
    select: { userId: true },
  });
  if (!script || script.userId !== user.id) {
    // 404 rather than 403 — don't reveal which ids exist to non-owners.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const saved = await prisma.scriptNote.create({
      data: {
        scriptId: parsed.scriptId,
        scriptLabel: parsed.scriptLabel ?? null,
        analysisId: parsed.analysisId ?? null,
        repoUrl: parsed.repoUrl ?? null,
        sceneIndex: parsed.sceneIndex,
        sceneId: parsed.sceneId,
        sceneTemplate: parsed.sceneTemplate,
        note: parsed.note,
        suspectArea: parsed.suspectArea ?? null,
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
