'use client';

import { useEffect, useState } from 'react';

interface Entry {
  id: string;
  amount: number;
  kind: string;
  refType: string;
  refId: string | null;
  memo: string | null;
  createdAt: string;
}

interface HistoryResponse {
  balance: number;
  availableBalance: number;
  entries: Entry[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; data: HistoryResponse }
  | { kind: 'error'; message: string };

export default function HistoryClient() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/credits/history');
        if (cancelled) return;
        if (res.status === 401) {
          setState({ kind: 'signed-out' });
          return;
        }
        if (!res.ok) throw new Error(`history ${res.status}`);
        setState({ kind: 'ready', data: (await res.json()) as HistoryResponse });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return <div className="auth-card"><p>Loading history…</p></div>;
  }
  if (state.kind === 'signed-out') {
    return (
      <div className="auth-card">
        <h1>Sign in to view history</h1>
        <a href="/login" className="btn-primary auth-submit">Sign in</a>
      </div>
    );
  }
  if (state.kind === 'error') {
    return <div className="auth-card"><p className="auth-error">{state.message}</p></div>;
  }

  const { data } = state;

  return (
    <div className="history">
      <header className="topup-header">
        <h1>Credit history</h1>
        <p className="auth-lede">
          Balance <strong>{data.balance.toLocaleString()}</strong> ·{' '}
          available{' '}
          <strong>{data.availableBalance.toLocaleString()}</strong>
          {data.balance !== data.availableBalance && (
            <span className="muted">
              {' '}
              ({(data.balance - data.availableBalance).toLocaleString()} held
              in reservations)
            </span>
          )}
        </p>
      </header>

      {data.entries.length === 0 ? (
        <p>No ledger entries yet.</p>
      ) : (
        <table className="history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Ref</th>
              <th>Memo</th>
              <th className="history-amount">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.kind}</td>
                <td>
                  {e.refType}
                  {e.refId ? ` · ${e.refId.slice(0, 8)}…` : ''}
                </td>
                <td>{e.memo ?? ''}</td>
                <td
                  className={`history-amount ${e.amount >= 0 ? 'history-credit' : 'history-debit'}`}
                >
                  {e.amount >= 0 ? '+' : ''}
                  {e.amount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
