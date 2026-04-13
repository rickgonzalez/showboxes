import { PrismaClient } from '@prisma/client';

// Singleton — Next.js dev mode re-imports modules on every request, so we
// stash the client on globalThis to avoid opening a new pool per reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
