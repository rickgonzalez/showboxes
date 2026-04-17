import { NextResponse } from 'next/server';
import { z } from 'zod';
import { estimateAnalysisCost } from '@/lib/costs/estimate';
import { codeAnalysisGnome } from '@/lib/agents/code-analysis.gnome';
import { AuthError, requireUser } from '@/lib/auth/session';
import { getBalanceForUser } from '@/lib/credits/ledger';
import { DEFAULT_DEPTH, type TriageReport } from '@showboxes/shared-types';

// Mirror of /api/analyze's mode schema. Kept in sync by hand — the two
// are small and duplicating avoids pulling route code into a library.
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
  mode: modeSchema.optional(),
  triageReport: z.record(z.string(), z.unknown()).optional(),
});

// POST /api/analyze/estimate — same body shape as /api/analyze, but
// returns only the estimate. No Analysis row, no reservation, no session.
// Auth is optional: if the caller is signed in we also return their
// current balance so the triage modal can show "~42 credits · you have 158".
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

  const triageReport = (parsed.triageReport as TriageReport | undefined) ?? null;
  const mode = parsed.mode ?? { kind: 'overview' as const };

  const estimate = estimateAnalysisCost({
    triageReport,
    mode,
    model: codeAnalysisGnome.defaultModel,
  });

  let balance: number | null = null;
  let availableBalance: number | null = null;
  try {
    const user = await requireUser(req);
    const summary = await getBalanceForUser(user.id);
    balance = summary.balance;
    availableBalance = summary.availableBalance;
  } catch (e) {
    // Unauthenticated is fine here — estimate is public. Anything else
    // we swallow rather than fail the estimate.
    if (!(e instanceof AuthError)) {
      console.error('[analyze/estimate] balance lookup failed:', e);
    }
  }

  return NextResponse.json({ estimate, balance, availableBalance });
}
