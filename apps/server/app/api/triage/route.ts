import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureProvisioned } from '@/lib/managed-agents/bootstrap';
import {
  startTriageSession,
  runTriageSessionToCompletion,
} from '@/lib/agents/triage-session';
import { codeTriageGnome } from '@/lib/agents/code-triage.gnome';
import Handlebars from 'handlebars';

// Triage is meant to finish in <60s. We run it synchronously so the
// UI can immediately show the focus-chooser modal.
export const maxDuration = 90;

const bodySchema = z.object({
  repoUrl: z.string().min(1),
});

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
    const { environmentExternalId, codeTriageAgentExternalId } =
      await ensureProvisioned();

    const userMessage = Handlebars.compile(
      codeTriageGnome.systemPromptTemplate,
      { noEscape: true },
    )({ repoUrl: parsed.repoUrl });

    const { sessionId } = await startTriageSession({
      agentExternalId: codeTriageAgentExternalId,
      environmentExternalId,
      userMessage,
      metadata: { repoUrl: parsed.repoUrl },
    });

    const { report } = await runTriageSessionToCompletion(sessionId);

    return NextResponse.json({ sessionId, report }, { status: 200 });
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json(
      { error: 'triage failed', detail: message },
      { status: 500 },
    );
  }
}
