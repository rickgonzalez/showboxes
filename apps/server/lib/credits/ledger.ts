/**
 * Credits ledger — wraps billable operations with a balance check + debit.
 *
 * This first pass is intentionally thin. The Prisma models
 * (`CreditAccount`, `LedgerEntry`, `Purchase`) are sketched in
 * docs/codesplain/CREDITS.md but not yet migrated. Until they land, this
 * file provides:
 *
 *   - `withCreditDebit()` — the wrapper routes should use now
 *   - an in-memory fallback account map so dev runs don't crash
 *   - a `InsufficientCredits` error that routes map to HTTP 402
 *
 * When the schema lands, swap the in-memory implementations out for
 * Prisma calls and keep the public API identical.
 */

import { debitFor, BillingKey, FREE_TIER_CREDITS } from './prices';

export class InsufficientCredits extends Error {
  constructor(public readonly needed: number, public readonly have: number) {
    super(`Insufficient credits: need ${needed}, have ${have}`);
    this.name = 'InsufficientCredits';
  }
}

export interface AccountRef {
  /** Email for pre-auth v1. Will become a Clerk user id later. */
  email: string;
}

export interface DebitOptions {
  account: AccountRef;
  /** Either a direct credit cost, or a (BillingKey, scale) pair. */
  cost: number | { key: BillingKey; scale?: number };
  /** What this debit refers back to. Stored on the LedgerEntry. */
  refType: 'analysis' | 'script' | 'voice' | 'adjustment' | 'grant';
  refId?: string;
  memo?: string;
}

/** ---------- in-memory fallback (dev only) ---------- */

const memBalances = new Map<string, number>();
const memEntries: Array<{
  email: string;
  amount: number;
  kind: string;
  refType: string;
  refId?: string;
  memo?: string;
  at: Date;
}> = [];

function ensureAccount(email: string): number {
  if (!memBalances.has(email)) {
    memBalances.set(email, FREE_TIER_CREDITS);
    memEntries.push({
      email,
      amount: FREE_TIER_CREDITS,
      kind: 'grant',
      refType: 'grant',
      refId: 'free_tier',
      memo: 'New account free-tier grant',
      at: new Date(),
    });
  }
  return memBalances.get(email)!;
}

/** ---------- public API ---------- */

export async function getBalance(account: AccountRef): Promise<{
  balance: number;
  recentEntries: typeof memEntries;
}> {
  const balance = ensureAccount(account.email);
  const recentEntries = memEntries
    .filter((e) => e.email === account.email)
    .slice(-20)
    .reverse();
  return { balance, recentEntries };
}

export async function credit(
  account: AccountRef,
  amount: number,
  refType: DebitOptions['refType'] | 'purchase',
  refId?: string,
  memo?: string,
): Promise<number> {
  if (amount <= 0) throw new Error('credit() amount must be positive');
  ensureAccount(account.email);
  const next = (memBalances.get(account.email) ?? 0) + amount;
  memBalances.set(account.email, next);
  memEntries.push({
    email: account.email,
    amount,
    kind: refType,
    refType,
    refId,
    memo,
    at: new Date(),
  });
  return next;
}

/**
 * Run `fn`, debiting the account on success. No debit on error — callers can
 * surface the underlying failure to the user as a free retry.
 */
export async function withCreditDebit<T>(
  opts: DebitOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const cost = typeof opts.cost === 'number'
    ? opts.cost
    : debitFor(opts.cost.key, opts.cost.scale ?? 1);

  const balance = ensureAccount(opts.account.email);
  if (balance < cost) throw new InsufficientCredits(cost, balance);

  const result = await fn();

  const next = balance - cost;
  memBalances.set(opts.account.email, next);
  memEntries.push({
    email: opts.account.email,
    amount: -cost,
    kind: 'usage',
    refType: opts.refType,
    refId: opts.refId,
    memo: opts.memo,
    at: new Date(),
  });

  return result;
}
