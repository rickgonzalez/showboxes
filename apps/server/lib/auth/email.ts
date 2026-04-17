import { Resend } from 'resend';

// We instantiate Resend lazily so the server can boot without the key
// (dev flows fall back to console logging). Production deploys must set
// both RESEND_API_KEY and AUTH_EMAIL_FROM — we log a warning otherwise.
let client: Resend | null = null;
function getClient(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

export interface SendMagicLinkParams {
  to: string;
  url: string;
}

export async function sendMagicLinkEmail({ to, url }: SendMagicLinkParams): Promise<void> {
  const from = process.env.AUTH_EMAIL_FROM;
  const resend = getClient();

  // Dev fallback — without a configured provider, dump the link to the
  // server console so local testing still works end-to-end.
  if (!resend || !from) {
    console.log(`[auth] magic link for ${to}: ${url}`);
    return;
  }

  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Sign in to Codesplain',
    html: renderHtml(url),
    text: renderText(url),
  });
  if (error) {
    throw new Error(`resend send failed: ${error.message}`);
  }
}

function renderText(url: string): string {
  return [
    'Click the link below to sign in to Codesplain.',
    '',
    url,
    '',
    'This link expires in 15 minutes and can only be used once.',
    'If you didn\'t request this, you can safely ignore the email.',
  ].join('\n');
}

function renderHtml(url: string): string {
  // Minimal, inline-styled — most clients strip <style> blocks.
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;background:#fafafa;padding:32px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;padding:32px;">
      <h1 style="font-size:18px;margin:0 0 16px;">Sign in to Codesplain</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 24px;">Click the button below to finish signing in.</p>
      <p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">Sign in</a></p>
      <p style="font-size:12px;color:#666;line-height:1.5;margin:0;">This link expires in 15 minutes and can only be used once. If you didn't request it, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
