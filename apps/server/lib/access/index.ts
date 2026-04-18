import type { Analysis, Script } from '@prisma/client';
import { AuthError, getOptionalUser } from '@/lib/auth/session';

// One place to decide whether a caller may read a Script. Scripts can
// be owner-private or shared via an unlisted shareToken. 'public' is
// reserved for a future release — canReadScript rejects it.
//
// See docs/codesplain/EMBED-AND-AUTH-PLAN.md §Access rules.

export type ReadDecision =
  | { ok: true; isOwner: boolean }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'unauthorized' };

interface CanReadScriptInput {
  visibility: string;
  userId: string | null;
  shareToken: string | null;
}

// Pass the shareToken provided by the caller (query param or header)
// along with the authenticated user if any. Returns a decision the
// caller maps to an HTTP status: `not_found` → 404 to avoid revealing
// which ids exist, `unauthorized` → 401 when a token is required but
// missing, `forbidden` → 403 for authenticated non-owners on private.
export function canReadScript(
  script: CanReadScriptInput,
  ctx: { user: { id: string } | null; providedToken: string | null },
): ReadDecision {
  const isOwner = !!ctx.user && script.userId === ctx.user.id;

  if (script.visibility === 'unlisted') {
    if (isOwner) return { ok: true, isOwner: true };
    if (!script.shareToken) return { ok: false, reason: 'not_found' };
    if (!ctx.providedToken) return { ok: false, reason: 'unauthorized' };
    if (ctx.providedToken !== script.shareToken) {
      return { ok: false, reason: 'forbidden' };
    }
    return { ok: true, isOwner: false };
  }

  if (script.visibility === 'private') {
    if (isOwner) return { ok: true, isOwner: true };
    return { ok: false, reason: 'not_found' };
  }

  // 'public' is not implemented yet; anything unknown is rejected.
  return { ok: false, reason: 'not_found' };
}

interface CanReadAnalysisInput {
  userId: string | null;
}

// Analyses are owner-only. They have no visibility column and no
// shareToken — they are internal intermediate artifacts that the UI
// never surfaces as a standalone resource.
export function canReadAnalysis(
  analysis: CanReadAnalysisInput,
  ctx: { user: { id: string } | null },
): ReadDecision {
  if (!ctx.user) return { ok: false, reason: 'unauthorized' };
  if (!analysis.userId) return { ok: false, reason: 'not_found' };
  if (analysis.userId !== ctx.user.id) return { ok: false, reason: 'not_found' };
  return { ok: true, isOwner: true };
}

// Token extractor: routes pull `?token=` off the URL and pass it in.
// Kept in one place so every endpoint reads tokens the same way.
export function extractShareToken(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get('token');
}

// Re-export so routes only need to import from one place when they're
// already pulling the helpers in.
export { getOptionalUser, AuthError };
