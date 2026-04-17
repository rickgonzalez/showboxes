// Session cookie — the id of a UserSession row. HttpOnly so JS can't read
// it; SameSite=Lax so normal top-level navigations (e.g. the magic-link
// click) still carry it but cross-site POSTs don't.

export const SESSION_COOKIE_NAME = 'cs_session';

export interface SessionCookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function buildSessionCookie(
  value: string,
  opts: SessionCookieOptions,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Minimal cookie-header parser — we only ever read one name.
export function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function isSecureRequest(): boolean {
  return process.env.NODE_ENV === 'production';
}
