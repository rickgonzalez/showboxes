import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { PresentationScript } from '@showboxes/shared-types';
import { defaultSettings } from '@showboxes/shared-types';
import { prisma } from '@/lib/prisma';
import { produceScript, ProducerError } from '../../../lib/agents/producer.client';
import {
  buildStageCost,
  rollupCosts,
  formatRollupLine,
  type StageCost,
} from '@/lib/costs/rollup';
import { AuthError, requireUser } from '@/lib/auth/session';

/**
 * /api/script — Agent 2 (Producer/Director).
 *
 * Accepts an analysis JSON and optional user settings. Calls the
 * Anthropic Messages API to produce a PresentationScript via tool use.
 *
 * If ANTHROPIC_API_KEY is not set, falls back to a fixture script
 * so local dev still works without an API key.
 */

const settingsSchema = z.object({
  audienceLevel: z.number().min(0).max(1).optional(),
  detailLevel: z.number().min(0).max(1).optional(),
  pace: z.number().min(0).max(1).optional(),
  persona: z.enum(['corporate', 'character', 'friendly', 'stern']).optional(),
  voice: z.object({
    provider: z.enum(['stub', 'elevenlabs', 'kokoro', 'google-neural2']).optional(),
    voiceId: z.string().optional(),
    speed: z.number().optional(),
  }).optional(),
  focusAreas: z.array(z.string()).optional(),
}).optional();

const bodySchema = z.object({
  analysis: z.any(),
  settings: settingsSchema,
  focusInstructions: z.string().optional(),
  /** Pass model override for testing (e.g. "claude-haiku-4-5-20251001") */
  model: z.string().optional(),
  /** Advisory link back to the Analysis row this script was derived from. */
  analysisId: z.string().optional(),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  // Script generation is free under the MVP debit policy — the Analysis
  // debit already covers it. Still requires a session so Script rows are
  // attributable. See docs/codesplain/AUTH-AND-BILLING-PLAN.md §Step 7.
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

  const analysis = parsed.analysis;
  const settings = {
    ...defaultSettings,
    ...parsed.settings,
    voice: {
      ...defaultSettings.voice,
      ...parsed.settings?.voice,
    },
  };

  // ── Fixture fallback when no API key ───────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[/api/script] ANTHROPIC_API_KEY not set — returning fixture script');
    const repoUrl = analysis?.quickFacts?.repoUrl ?? 'unknown-repo';
    return NextResponse.json(buildFixtureScript(repoUrl));
  }

  // ── Call Agent 2 ───────────────────────────────────────────────
  try {
    const result = await produceScript({
      analysis,
      settings,
      focusInstructions: parsed.focusInstructions,
      model: parsed.model,
    });

    // Persist independently of the Analysis row — scripts survive
    // analysis deletion, and the `analysisId` column is advisory only.
    const repoUrl =
      result.script.meta.repoUrl ?? analysis?.quickFacts?.repoUrl ?? 'unknown-repo';
    const label = `${result.script.meta.persona} · ${new Date()
      .toISOString()
      .replace('T', ' ')
      .slice(0, 16)}`;

    // ── Cost rollup ─────────────────────────────────────────────────
    // Pull upstream stage costs (triage + analysis) from the Analysis
    // row this script was derived from, then add the producer stage.
    // Store the whole rollup on Script.usage so `GET /api/scripts/:id/cost`
    // can return a full picture without joining.
    const upstream: StageCost[] = parsed.analysisId
      ? await loadUpstreamStageCosts(parsed.analysisId)
      : [];
    const producerStage = buildStageCost(
      'producer',
      parsed.model ?? 'claude-sonnet-4-5', // producer default — keep in sync with produceScript
      {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
    );
    const rollup = rollupCosts([...upstream, producerStage]);

    let saved: { id: string };
    try {
      saved = await prisma.script.create({
        data: {
          analysisId: parsed.analysisId ?? null,
          repoUrl,
          label,
          persona: result.script.meta.persona,
          status: 'ready',
          data: result.script as unknown as object,
          settings: settings as unknown as object,
          focusInstructions: parsed.focusInstructions ?? null,
          producerModel: parsed.model ?? null,
          // `usage` column now holds the full CostRollup — not just producer tokens.
          usage: rollup as unknown as object,
          userId: user.id,
          // New scripts start private; owners opt-in to 'unlisted' via a
          // share flow (not built in this PR).
          visibility: 'private',
        },
        select: { id: true },
      });
    } catch (dbErr) {
      console.error('[/api/script] failed to persist script:', dbErr);
      return NextResponse.json(
        {
          error: 'PERSIST_FAILED',
          detail: (dbErr as Error).message,
          script: result.script,
          _usage: rollup,
        },
        { status: 500 },
      );
    }

    // One-line cost summary on every successful run. Grep "[cost]" in
    // dev logs to eyeball totals as the product takes shape.
    console.log(formatRollupLine(rollup, saved.id));

    return NextResponse.json({
      ...result.script,
      _usage: rollup,
      _id: saved.id,
      _label: label,
    });
  } catch (e) {
    if (e instanceof ProducerError) {
      console.error(`[/api/script] ProducerError (${e.code}): ${e.message}`);
      return NextResponse.json(
        { error: e.code, detail: e.message },
        { status: 502 },
      );
    }
    console.error('[/api/script] Unexpected error:', e);
    return NextResponse.json(
      { error: 'API_ERROR', detail: (e as Error).message },
      { status: 500 },
    );
  }
}

// ── Upstream stage cost loader ───────────────────────────────────

/**
 * Read the stageCosts blob off the Analysis this Script was derived
 * from, if any. Returns an empty array on miss so the producer stage
 * always lands somewhere. Never throws.
 */
async function loadUpstreamStageCosts(analysisId: string): Promise<StageCost[]> {
  try {
    const row = await prisma.analysis.findUnique({
      where: { id: analysisId },
      select: { stageCosts: true },
    });
    const blob = row?.stageCosts;
    if (Array.isArray(blob)) return blob as unknown as StageCost[];
    return [];
  } catch (err) {
    console.warn(
      '[/api/script] could not read upstream stageCosts for analysis',
      analysisId,
      (err as Error).message,
    );
    return [];
  }
}

// ── Fixture for local dev without API key ────────────────────────

function buildFixtureScript(repoUrl: string): PresentationScript {
  const palette = {
    primary: '#3b82f6',
    secondary: '#a855f7',
    accent: '#f59e0b',
    background: '#0f172a',
    text: '#f8fafc',
    code: '#94a3b8',
  };
  const transition = { type: 'fade' as const, durationMs: 400 };
  const voice = { provider: 'stub' as const, voiceId: 'stub-1', speed: 1.0 };

  return {
    meta: {
      title: `${repoUrl} — a tour`,
      repoUrl,
      generatedAt: new Date().toISOString(),
      persona: 'friendly',
      estimatedDuration: 22,
    },
    defaults: { palette, transition, voice },
    scenes: [
      {
        id: 's1',
        section: 'quickFacts',
        primitive: {
          template: 'title-bullets',
          content: {
            title: `${repoUrl.split('/').pop() ?? 'repo'} — at a glance`,
            bullets: [
              'Fixture mode — ANTHROPIC_API_KEY not set.',
              'Set the key in .env.local to enable Agent 2.',
              'The contract here is PresentationScript.',
            ],
            titleFx: [{ name: 'slam', duration: 520 }],
          },
        },
        narration:
          'This is a fixture script. Set your Anthropic API key to enable the real producer agent.',
        holdSeconds: 5,
      },
      {
        id: 's2',
        section: 'health',
        primitive: {
          template: 'emphasis-word',
          content: {
            word: 'READY',
            subtitle: 'Pipeline is wired. Add ANTHROPIC_API_KEY to go live.',
            fx: [
              { name: 'slam', duration: 520 },
              { name: 'glow', duration: 1400, strength: 40, color: '#3b82f6' },
            ],
            style: { size: 120, weight: '900', color: '#3b82f6' },
          },
        },
        narration: 'The pipeline is wired end to end. Add your API key and the producer agent takes over.',
        holdSeconds: 5,
      },
    ],
  };
}
