'use client';

import { useEffect, useState } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'error';

const ERROR_COPY: Record<string, string> = {
  invalid: 'That link is invalid. Request a new one below.',
  used: 'That link was already used. Request a new one below.',
  expired: 'That link expired. Request a new one below.',
};

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Surface the magic-link failure code the verify route attached.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err && ERROR_COPY[err]) setLinkError(ERROR_COPY[err]);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus('sending');
    setErrorMsg(null);
    try {
      const next = new URLSearchParams(window.location.search).get('next');
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed, ...(next ? { next } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'request failed' }));
        throw new Error(body.error ?? 'request failed');
      }
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  };

  if (status === 'sent') {
    return (
      <div className="auth-card">
        <h1>Check your email</h1>
        <p className="auth-lede">
          We sent a sign-in link to <strong>{email}</strong>. It expires in 15
          minutes.
        </p>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setStatus('idle');
            setErrorMsg(null);
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <h1>Sign in to Codesplain</h1>
      <p className="auth-lede">
        We&apos;ll email you a one-time sign-in link. New accounts start with a
        free-tier credit grant.
      </p>

      {linkError && <div className="auth-notice">{linkError}</div>}

      <label className="auth-field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'sending'}
        />
      </label>

      {errorMsg && <div className="auth-error">{errorMsg}</div>}

      <button
        type="submit"
        className="btn-primary auth-submit"
        disabled={status === 'sending' || email.trim().length === 0}
      >
        {status === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}
