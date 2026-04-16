import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ensureProvisioned } from '@/lib/managed-agents/bootstrap';
import { startSession, runSessionToCompletion } from '@/lib/agents/session';
import { codeAnalysisGnome, gnomeVersion } from '@/lib/agents/code-analysis.gnome';
import { codeTriageGnome } from '@/lib/agents/code-triage.gnome';
import { renderCodeAnalysisPrompt } from '@/lib/agents/render-prompt';
import { traceMode } from '@/lib/agents/trace-mode';
import { fetchSessionTokens } from '@/lib/costs/managed-agents-usage';
import { buildStageCost } from '@/lib/costs/rollup';
import { DEFAULT_DEPTH, type TriageReport } from '@showboxes/shared-types';

// Agent 1 runs long. Vercel default function timeout (10s Hobby / 60s Pro)
// isn't enough; crank it. `after()` continues past the response anyway,
// but we want the foreground provisioning call to complete.
export const maxDuration = 60;

// `mode` comes from the post-triage chooser. If absent, the analysis
// runs in full-coverage mode (existing behavior).
const modeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overview') }),
  z.object({
    kind: z.literal('focused-brief'),
    subsystems: z.array(z.string()).min(1),
    depth: z.number().min(0).max(1).default(DEFAULT_DEPTH),
  }),
  z.object({ kind: z.literal('scorecard') }),
  z.object({ kind: z.literal('walkthrough'), entryPoint: z.string() }),
]);

const bodySchema = z.object({
  repoUrl: z.string().min(1),
  focusAreas: z.array(z.string()).optional(),
  priorityPaths: z.array(z.string()).optional(),
  mode: modeSchema.optional(),
  // Optional pass-through from the triage step. Used only for the
  // tunables trace — opaque diagnostic blob, not validated structurally.
  triageReport: z.record(z.string(), z.unknown()).optional(),
  // Optional — the Managed Agents session id from the triage step.
  // When present, we fetch its final usage at completion and fold it
  // into this Analysis's stageCosts so downstream Scripts can see
  // triage cost without re-running anything.
  triageSessionId: z.string().optional(),
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

  const triageReport = (parsed.triageReport as TriageReport | undefined) ?? undefined;

  const record = await prisma.analysis.create({
    data: {
      repoUrl: parsed.repoUrl,
      status: 'running',
      agentVersion: gnomeVersion(codeAnalysisGnome),
      // Populated below once we've rendered the prompt and know the
      // effective (post-clamp) mode.
      tunables: {} as unknown as object,
    },
  });

  // Kick off the session. The create + first user.message go in the
  // foreground so we can surface quota / auth errors to the client;
  // the long poll happens in after().
  let sessionId: string;
  try {
    const { environmentExternalId, codeAnalysisAgentExternalId } =
      await ensureProvisioned();

    const { prompt: userMessage, effectiveMode, clampedSubsystems } =
      renderCodeAnalysisPrompt(codeAnalysisGnome.systemPromptTemplate, {
        repoUrl: parsed.repoUrl,
        focusAreas: parsed.focusAreas,
        priorityPaths: parsed.priorityPaths,
        mode: parsed.mode,
        triageReport,
      });

    const tunables = traceMode({
      report: triageReport ?? null,
      mode: effectiveMode,
      clampedSubsystems,
    });

    const start = await startSession({
      agentExternalId: codeAnalysisAgentExternalId,
      environmentExternalId,
      userMessage,
      metadata: { analysisId: record.id, repoUrl: parsed.repoUrl },
    });
    sessionId = start.sessionId;

    await prisma.analysis.update({
      where: { id: record.id },
      data: { sessionId, tunables: tunables as unknown as object },
    });
  } catch (e) {
    const message = (e as Error).message;
    await prisma.analysis.update({
      where: { id: record.id },
      data: { status: 'error', error: message },
    });
    return NextResponse.json(
      { error: 'failed to start analysis', detail: message, id: record.id },
      { status: 500 },
    );
  }

  // Drive the session to completion in the background. `after()` keeps
  // the function alive past the response so we can poll the Managed
  // Agents session without blocking the client.
  after(async () => {
    try {
      const result = await runSessionToCompletion(sessionId);

      // Capture per-stage Anthropic usage so the downstream Script
      // rollup can answer "what did this run cost me?" without a
      // second round-trip. Failures here are non-fatal — we still
      // want the analysis written.
      const stageCosts = [];
      if (parsed.triageSessionId) {
        const triageTokens = await fetchSessionTokens(parsed.triageSessionId);
        stageCosts.push(
          buildStageCost('triage', codeTriageGnome.defaultModel, triageTokens),
        );
      }
      const analysisTokens = await fetchSessionTokens(sessionId);
      stageCosts.push(
        buildStageCost('analysis', codeAnalysisGnome.defaultModel, analysisTokens),
      );

      await prisma.analysis.update({
        where: { id: record.id },
        data: {
          status: 'ready',
          data: result.analysis as unknown as object,
          stageCosts: stageCosts as unknown as object,
        },
      });
    } catch (e) {
      await prisma.analysis.update({
        where: { id: record.id },
        data: { status: 'error', error: (e as Error).message },
      });
    }
  });

  return NextResponse.json(
    { id: record.id, sessionId, status: 'running' },
    { status: 202 },
  );
}
