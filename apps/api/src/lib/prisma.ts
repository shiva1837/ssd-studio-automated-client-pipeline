/**
 * SSD Studio — Prisma Client Singleton
 * Prevents connection-pool exhaustion during hot-reload in development
 * by reusing a single PrismaClient instance across the module graph.
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ssdPrisma: PrismaClient | undefined;
}

const prisma =
  global.__ssdPrisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__ssdPrisma = prisma;
}

export { prisma };
export default prisma;
