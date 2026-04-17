'use client';

import { useEffect, useRef, useState } from 'react';

interface Me {
  email: string;
  balance: number;
  availableBalance: number;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; me: Me };

export default function UserMenu() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!cancelled) {
          if (res.ok) {
            const me = (await res.json()) as Me;
            setState({ kind: 'signed-in', me });
          } else {
            setState({ kind: 'signed-out' });
          }
        }
      } catch {
        if (!cancelled) setState({ kind: 'signed-out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (state.kind === 'loading') {
    return <div className="user-menu-placeholder" aria-hidden />;
  }

  if (state.kind === 'signed-out') {
    return (
      <a href="/login" className="nav-cta">
        Sign in
      </a>
    );
  }

  const { me } = state;
  const initial = (me.email[0] ?? '?').toUpperCase();

  const onSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore — we're nuking local UI state anyway.
    }
    window.location.href = '/';
  };

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-menu-avatar">{initial}</span>
        <span className="user-menu-balance">
          {me.availableBalance.toLocaleString()} cr
        </span>
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-email" title={me.email}>
              {me.email}
            </div>
            <div className="user-menu-balance-row">
              <span>Available</span>
              <strong>{me.availableBalance.toLocaleString()} cr</strong>
            </div>
            {me.balance !== me.availableBalance && (
              <div className="user-menu-balance-row muted">
                <span>Ledger</span>
                <span>{me.balance.toLocaleString()} cr</span>
              </div>
            )}
          </div>
          <a href="/account/topup" role="menuitem" className="user-menu-item">
            Top up
          </a>
          <a
            href="/account/history"
            role="menuitem"
            className="user-menu-item"
          >
            History
          </a>
          <button
            type="button"
            role="menuitem"
            className="user-menu-item user-menu-item-danger"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
