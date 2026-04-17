/**
 * Credits ledger — real Prisma-backed implementation.
 *
 * Public surface kept stable for legacy callers (balance/history/webhook
 * routes still pass AccountRef{email}). Internally, everything resolves
 * to a User row and writes to LedgerEntry / CreditReservation. See
 * docs/codesplain/AUTH-AND-BILLING-PLAN.md §Step 3 for semantics.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { debitFor, BillingKey, FREE_TIER_CREDITS } from './prices';

export class InsufficientCredits extends Error {
  constructor(public readonly needed: number, public readonly have: number) {
    super(`Insufficient credits: need ${needed}, have ${have}`);
    this.name = 'InsufficientCredits';
  }
}

export interface AccountRef {
  /** Email for legacy callers. Will be supplanted by session-derived userId. */
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

// Default reservation TTL. Reservations should normally settle in under
// a minute (analysis completion) or release on error; anything still
// held past this is assumed orphaned and picked up by the reaper.
const DEFAULT_RESERVATION_TTL_MIN = 15;

// Upsert-by-email with free-tier grant on first sight. Idempotent on
// the grant via a guard on `refType='grant' AND refId='free_tier'`.
async function ensureUserByEmail(email: string): Promise<{ id: string; balance: number }> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email: normalized },
    update: {},
    create: { email: normalized },
  });

  const grant = await prisma.ledgerEntry.findFirst({
    where: { userId: user.id, refType: 'grant', refId: 'free_tier' },
    select: { id: true },
  });
  if (grant) return { id: user.id, balance: user.balance };

  const [, updated] = await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        amount: FREE_TIER_CREDITS,
        kind: 'grant',
        refType: 'grant',
        refId: 'free_tier',
        memo: 'New account free-tier grant',
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { balance: { increment: FREE_TIER_CREDITS } },
    }),
  ]);
  return { id: updated.id, balance: updated.balance };
}

export interface LedgerSummary {
  balance: number;
  availableBalance: number;
  recentEntries: Array<{
    id: string;
    amount: number;
    kind: string;
    refType: string;
    refId: string | null;
    memo: string | null;
    createdAt: Date;
  }>;
}

export async function getBalance(account: AccountRef): Promise<LedgerSummary> {
  const { id } = await ensureUserByEmail(account.email);
  return summarize(id);
}

export async function getBalanceForUser(userId: string): Promise<LedgerSummary> {
  return summarize(userId);
}

async function summarize(userId: string): Promise<LedgerSummary> {
  const [user, heldAgg, entries] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } }),
    prisma.creditReservation.aggregate({
      where: { userId, status: 'held' },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  return {
    balance: user.balance,
    availableBalance: user.balance - (heldAgg._sum.amount ?? 0),
    recentEntries: entries,
  };
}

export async function credit(
  account: AccountRef,
  amount: number,
  refType: DebitOptions['refType'] | 'purchase',
  refId?: string,
  memo?: string,
): Promise<number> {
  if (amount <= 0) throw new Error('credit() amount must be positive');
  const { id } = await ensureUserByEmail(account.email);
  return creditUser({ userId: id, amount, refType, refId, memo });
}

// Session-aware variant used by real auth + Stripe flows. Idempotent per
// (refType, refId) when a refId is provided so re-delivered webhooks don't
// double-credit.
export async function creditUser(params: {
  userId: string;
  amount: number;
  refType: DebitOptions['refType'] | 'purchase';
  refId?: string;
  memo?: string;
}): Promise<number> {
  if (params.amount <= 0) throw new Error('creditUser() amount must be positive');

  if (params.refId) {
    const dupe = await prisma.ledgerEntry.findFirst({
      where: { userId: params.userId, refType: params.refType, refId: params.refId },
      select: { id: true },
    });
    if (dupe) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: params.userId },
        select: { balance: true },
      });
      return user.balance;
    }
  }

  const [, updated] = await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: {
        userId: params.userId,
        amount: params.amount,
        kind: params.refType,
        refType: params.refType,
        refId: params.refId,
        memo: params.memo,
      },
    }),
    prisma.user.update({
      where: { id: params.userId },
      data: { balance: { increment: params.amount } },
    }),
  ]);
  return updated.balance;
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

  const { id } = await ensureUserByEmail(opts.account.email);
  const available = await computeAvailable(id);
  if (available < cost) throw new InsufficientCredits(cost, available);

  const result = await fn();

  await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: {
        userId: id,
        amount: -cost,
        kind: 'usage',
        refType: opts.refType,
        refId: opts.refId,
        memo: opts.memo,
      },
    }),
    prisma.user.update({
      where: { id },
      data: { balance: { decrement: cost } },
    }),
  ]);

  return result;
}

// ---------- Reservations ----------

export interface ReserveParams {
  userId: string;
  amount: number;
  refType: string;
  refId: string;
  ttlMinutes?: number;
}

/**
 * Hold `amount` credits against the user's balance. Throws InsufficientCredits
 * if available (balance − currently-held) is less than amount. Writes a
 * CreditReservation row in status 'held'; does NOT write a LedgerEntry.
 *
 * The balance check + reservation write run inside a serializable
 * transaction to avoid the two-analyses-started-in-the-same-second race.
 */
export async function reserveCredits(
  params: ReserveParams,
): Promise<{ reservationId: string }> {
  if (params.amount <= 0) {
    throw new Error('reserveCredits() amount must be positive');
  }
  const ttlMin = params.ttlMinutes ?? DEFAULT_RESERVATION_TTL_MIN;

  const reservation = await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: params.userId },
        select: { balance: true },
      });
      const held = await tx.creditReservation.aggregate({
        where: { userId: params.userId, status: 'held' },
        _sum: { amount: true },
      });
      const available = user.balance - (held._sum.amount ?? 0);
      if (available < params.amount) {
        throw new InsufficientCredits(params.amount, available);
      }
      return tx.creditReservation.create({
        data: {
          userId: params.userId,
          amount: params.amount,
          refType: params.refType,
          refId: params.refId,
          status: 'held',
          expiresAt: new Date(Date.now() + ttlMin * 60 * 1000),
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );

  return { reservationId: reservation.id };
}

/**
 * Consume a reservation by debiting `actualAmount` credits. `actualAmount`
 * may be less than the held amount (job cost less than estimated) or more
 * (job overran — we debit anyway, per the plan's policy-A decision).
 * Idempotent: a reservation already `settled` or `released` short-circuits.
 */
export async function settleReservation(
  reservationId: string,
  actualAmount: number,
  memo?: string,
): Promise<void> {
  if (actualAmount < 0) {
    throw new Error('settleReservation() actualAmount must be >= 0');
  }

  await prisma.$transaction(async (tx) => {
    const r = await tx.creditReservation.findUnique({ where: { id: reservationId } });
    if (!r) throw new Error(`reservation not found: ${reservationId}`);
    if (r.status !== 'held') return; // idempotent no-op

    const ops: Prisma.PrismaPromise<unknown>[] = [
      tx.creditReservation.update({
        where: { id: reservationId },
        data: { status: 'settled', settledAmount: actualAmount },
      }),
    ];
    if (actualAmount > 0) {
      ops.push(
        tx.ledgerEntry.create({
          data: {
            userId: r.userId,
            amount: -actualAmount,
            kind: 'usage',
            refType: r.refType,
            refId: r.refId,
            memo: memo ?? `reservation:${reservationId}`,
          },
        }),
        tx.user.update({
          where: { id: r.userId },
          data: { balance: { decrement: actualAmount } },
        }),
      );
    }
    await Promise.all(ops);
  });
}

/**
 * Release a reservation without debiting — used when the underlying
 * operation failed. Writes no LedgerEntry. Idempotent.
 */
export async function releaseReservation(
  reservationId: string,
  reason?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const r = await tx.creditReservation.findUnique({ where: { id: reservationId } });
    if (!r) return;
    if (r.status !== 'held') return;
    await tx.creditReservation.update({
      where: { id: reservationId },
      data: { status: 'released', settledAmount: 0 },
    });
    // Reason is logged via memo on an audit entry only when provided, to
    // keep the ledger readable for normal releases.
    if (reason) {
      console.log(`[credits] released reservation ${reservationId}: ${reason}`);
    }
  });
}

/**
 * Release any reservations whose expiresAt has passed. Run from a cron
 * or `after()` every few minutes as a safety net; the happy path should
 * always settle/release explicitly. Returns the count released.
 */
export async function reapExpiredReservations(): Promise<number> {
  const expired = await prisma.creditReservation.findMany({
    where: { status: 'held', expiresAt: { lt: new Date() } },
    select: { id: true },
  });
  for (const { id } of expired) {
    await releaseReservation(id, 'expired');
  }
  return expired.length;
}

// ---------- internals ----------

async function computeAvailable(userId: string): Promise<number> {
  const [user, held] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    }),
    prisma.creditReservation.aggregate({
      where: { userId, status: 'held' },
      _sum: { amount: true },
    }),
  ]);
  return user.balance - (held._sum.amount ?? 0);
}
