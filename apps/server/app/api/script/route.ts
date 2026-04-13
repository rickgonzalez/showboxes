import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { PresentationScript } from '@showboxes/shared-types';
import { defaultSettings } from '@showboxes/shared-types';
import { produceScript, ProducerError } from '../../../lib/agents/producer.client';

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
    provider: z.enum(['stub', 'elevenlabs', 'kokoro']).optional(),
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

    return NextResponse.json({
      ...result.script,
      _usage: result.usage,
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
