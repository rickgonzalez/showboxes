import { randomBytes, createHash } from 'node:crypto';

// Magic-link tokens are 32 bytes of URL-safe randomness — opaque to the
// client, never stored in plaintext. We keep only the sha256 hash in
// MagicLink.tokenHash so a DB leak can't be replayed.
export function generateMagicLinkToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Standard link lifetime. 15 min is the industry default; extend to 30 if
// users complain about expired links on slow inboxes.
export const MAGIC_LINK_TTL_MINUTES = 15;

// Sessions live 30 days. Every `requireUser` call bumps `lastSeenAt`, but
// we deliberately don't slide the expiry — forcing a re-auth every month
// keeps stale sessions from lingering forever.
export const SESSION_TTL_DAYS = 30;
