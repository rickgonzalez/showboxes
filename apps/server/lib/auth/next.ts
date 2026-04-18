// Open-redirect guard: `next` must be a same-origin relative path
// starting with a single '/', not '//' (protocol-relative) or any scheme.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  return raw;
}

export const NEXT_COOKIE_NAME = 'cs_next';
export const NEXT_COOKIE_TTL_SECONDS = 60 * 20; // 20 min; magic-link TTL is 15

export function buildNextCookie(value: string, secure: boolean): string {
  const parts = [
    `${NEXT_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${NEXT_COOKIE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearNextCookie(secure: boolean): string {
  const parts = [
    `${NEXT_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
