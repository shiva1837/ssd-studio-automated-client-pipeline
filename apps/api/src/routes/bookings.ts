/**
 * SSD Studio — Booking Routes
 * Implements global state locking to mathematically prevent double-bookings.
 * Uses a two-phase: Redis distributed lock + PostgreSQL serializable transaction.
 */

import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';
import { sendBookingCreatedEmail, sendBookingStatusEmail } from '../lib/email';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus, Prisma } from '@prisma/client';

export const bookingsRouter = Router();

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

const CreateBookingSchema = z.object({
  serviceType: z.string().min(1).max(100),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  notes: z.string().max(1000).optional(),
});

// Clients may only update notes. Status transitions (CONFIRMED, COMPLETED)
// happen exclusively through the Stripe webhook; .strict() rejects any
// attempt to send status or other fields.
const UpdateBookingSchema = z
  .object({
    notes: z.string().max(1000).optional(),
  })
  .strict();

// ============================================================
// DISTRIBUTED LOCK UTILITIES
// ============================================================

const LOCK_TTL_MS = Number(process.env.BOOKING_LOCK_TTL_SECONDS || 300) * 1000;
const LOCK_PREFIX = 'booking:slot:lock:';
const SLOT_BUCKET_MS = Number(process.env.BOOKING_SLOT_DURATION_MINUTES || 60) * 60 * 1000;
// Caps the bucket count per request — an unbounded range (e.g. 1970→3000)
// would otherwise generate millions of Redis keys from a single call.
const MAX_BOOKING_DURATION_HOURS = Number(process.env.MAX_BOOKING_DURATION_HOURS || 24);
const MAX_BOOKING_DURATION_MS = MAX_BOOKING_DURATION_HOURS * 60 * 60 * 1000;

/**
 * Discretizes a time range into fixed slot buckets so overlapping ranges
 * always contend on at least one shared lock key. A 10:00-11:00 booking and
 * a 10:30-11:30 booking both cover the 10:00 bucket and cannot proceed
 * concurrently, which the previous exact startTime:endTime key allowed.
 */
function getSlotBucketKeys(startTime: Date, endTime: Date): string[] {
  const keys: string[] = [];
  let bucket = Math.floor(startTime.getTime() / SLOT_BUCKET_MS) * SLOT_BUCKET_MS;
  for (; bucket < endTime.getTime(); bucket += SLOT_BUCKET_MS) {
    keys.push(`${LOCK_PREFIX}${new Date(bucket).toISOString()}`);
  }
  return keys;
}

const RELEASE_LOCK_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Acquires Redis locks on every slot bucket the range covers.
 * Returns the lock token if all buckets were acquired, null if any bucket
 * is contested (already-acquired buckets are rolled back).
 * This is the FIRST defensive layer against double-bookings.
 */
async function acquireSlotLock(startTime: Date, endTime: Date): Promise<string | null> {
  const bucketKeys = getSlotBucketKeys(startTime, endTime);
  const lockToken = uuidv4();
  const lockExpiry = Math.ceil(LOCK_TTL_MS / 1000);

  const acquired: string[] = [];
  for (const key of bucketKeys) {
    // NX = only set if Not eXists. This is atomic in Redis.
    const result = await redis.set(key, lockToken, 'EX', lockExpiry, 'NX');
    if (result === 'OK') {
      acquired.push(key);
    } else {
      logger.warn(`Slot lock contested: ${key}`);
      await Promise.all(acquired.map((k) => redis.eval(RELEASE_LOCK_LUA, 1, k, lockToken)));
      return null;
    }
  }

  logger.info(`Slot lock acquired: [${bucketKeys.join(', ')}] with token ${lockToken}`);
  return lockToken;
}

async function releaseSlotLock(startTime: Date, endTime: Date, lockToken: string): Promise<void> {
  const bucketKeys = getSlotBucketKeys(startTime, endTime);
  // Only release buckets we own (compare-and-delete via Lua)
  await Promise.all(
    bucketKeys.map((key) => redis.eval(RELEASE_LOCK_LUA, 1, key, lockToken))
  );
}

// ============================================================
// SERIALIZABLE TRANSACTION RETRY
// ============================================================

const MAX_TX_ATTEMPTS = 3;

/**
 * Runs a serializable transaction, retrying on Prisma P2034 (serialization
 * failure / deadlock) with exponential backoff and jitter. Serializable
 * isolation aborts one of two concurrent conflicting transactions by design;
 * a retry is the correct response, not an error.
 */
async function runSerializableTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (error) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!isSerializationFailure || attempt >= MAX_TX_ATTEMPTS) {
        throw error;
      }
      const backoffMs = 50 * 2 ** attempt + Math.floor(Math.random() * 100);
      logger.warn(
        `Serialization failure (P2034), retrying transaction in ${backoffMs}ms (attempt ${attempt}/${MAX_TX_ATTEMPTS})`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

// ============================================================
// N8N WEBHOOK NOTIFICATION
// ============================================================

function notifyN8n(path: string, payload: Record<string, unknown>): void {
  setImmediate(async () => {
    try {
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
      if (!n8nWebhookUrl) return;
      await fetch(`${n8nWebhookUrl}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      logger.warn(`Failed to notify n8n (${path}):`, err);
    }
  });
}

// ============================================================
// GET /api/bookings — List bookings for authenticated user
// ============================================================
bookingsRouter.get('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { status, page = '1', limit = '20' } = req.query;
  // parseInt returns NaN for non-numeric input; `|| fallback` catches it
  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  // An arbitrary string cast to the Prisma enum would throw a 500 in the query
  if (status && !Object.values(BookingStatus).includes(status as BookingStatus)) {
    res.status(400).json({
      error: `Invalid status. Must be one of: ${Object.values(BookingStatus).join(', ')}`,
    });
    return;
  }

  const where = {
    clientId: req.user!.id,
    ...(status ? { status: status as BookingStatus } : {}),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { mediaAssets: { select: { id: true, assetType: true, deliveryStatus: true } } },
      orderBy: { startTime: 'desc' },
      skip,
      take: limitNum,
    }),
    prisma.booking.count({ where }),
  ]);

  res.json({
    data: bookings,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
}));

// ============================================================
// GET /api/bookings/availability — Check slot availability
// ============================================================
bookingsRouter.get('/availability', asyncHandler(async (req, res) => {
  const { startTime, endTime } = req.query;

  if (!startTime || !endTime) {
    res.status(400).json({ error: 'startTime and endTime query parameters are required' });
    return;
  }

  const start = new Date(startTime as string);
  const end = new Date(endTime as string);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ error: 'Invalid date format. Use ISO 8601.' });
    return;
  }

  if (end <= start || end.getTime() - start.getTime() > MAX_BOOKING_DURATION_MS) {
    res.status(400).json({
      error: `Requested range must be positive and at most ${MAX_BOOKING_DURATION_HOURS} hours`,
    });
    return;
  }

  // Check for overlapping confirmed/pending bookings
  const conflictingBookings = await prisma.booking.count({
    where: {
      status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      OR: [
        { startTime: { lt: end }, endTime: { gt: start } },
      ],
    },
  });

  const bucketKeys = getSlotBucketKeys(start, end);
  const lockedBuckets = bucketKeys.length > 0 ? await redis.exists(...bucketKeys) : 0;

  res.json({
    available: conflictingBookings === 0 && lockedBuckets === 0,
    hasConflict: conflictingBookings > 0,
    hasActiveLock: lockedBuckets > 0,
    requestedSlot: { startTime: start, endTime: end },
  });
}));

// ============================================================
// POST /api/bookings — Reserve a booking slot
// CRITICAL: Two-phase locking prevents double-bookings
// ============================================================
bookingsRouter.post('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validation = CreateBookingSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(422).json({ error: 'Validation failed', details: validation.error.format() });
    return;
  }

  const { serviceType, notes } = validation.data;
  const startTime = new Date(validation.data.startTime);
  const endTime = new Date(validation.data.endTime);

  if (endTime <= startTime) {
    res.status(400).json({ error: 'endTime must be after startTime' });
    return;
  }

  if (endTime.getTime() - startTime.getTime() > MAX_BOOKING_DURATION_MS) {
    res.status(400).json({
      error: `Booking duration cannot exceed ${MAX_BOOKING_DURATION_HOURS} hours`,
    });
    return;
  }

  if (startTime < new Date()) {
    res.status(400).json({ error: 'Cannot book a slot in the past' });
    return;
  }

  // ── Phase 1: Acquire distributed Redis lock ──────────────
  const lockToken = await acquireSlotLock(startTime, endTime);
  if (!lockToken) {
    res.status(409).json({
      error: 'Slot Conflict',
      message: 'This time slot is currently being reserved. Please try again in a few seconds.',
      code: 'SLOT_LOCKED',
    });
    return;
  }

  try {
    // ── Phase 2: PostgreSQL serializable transaction ─────────
    // This second layer guarantees atomicity at the DB level,
    // handling any edge case where Redis and Postgres diverge.
    // Retried on P2034 serialization failures with backoff + jitter.
    const booking = await runSerializableTransaction(async (tx: Prisma.TransactionClient) => {
      // Re-check for conflicts inside the transaction (serializable isolation)
      const existingConflict = await tx.booking.findFirst({
        where: {
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });

      if (existingConflict) {
        throw new Error('SLOT_CONFLICT: Overlapping booking detected');
      }

      return tx.booking.create({
        data: {
          clientId: req.user!.id,
          serviceType,
          startTime,
          endTime,
          status: BookingStatus.PENDING,
          notes,
          lockToken,
          lockExpiresAt: new Date(Date.now() + LOCK_TTL_MS),
        },
      });
    });

    logger.info(`Booking created: ${booking.id} for user ${req.user!.id}`);

    await writeAuditLog('booking', booking.id, 'CREATED', req.user!.id, {
      serviceType,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });

    sendBookingCreatedEmail(req.user!, booking);

    // Emit webhook to n8n for confirmation email workflow
    // (n8n listens on its webhook endpoint)
    notifyN8n('booking-created', {
      bookingId: booking.id,
      event: 'BOOKING_CREATED',
      clientEmail: req.user!.email,
      clientName: req.user!.name,
      serviceType,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });

    res.status(201).json({ data: booking, message: 'Booking reserved successfully.' });
  } catch (error) {
    // Release lock on failure
    await releaseSlotLock(startTime, endTime, lockToken);

    if (error instanceof Error && error.message.startsWith('SLOT_CONFLICT')) {
      res.status(409).json({
        error: 'Slot Conflict',
        message: 'This slot was just booked by another client. Please choose a different time.',
        code: 'SLOT_CONFLICT',
      });
      return;
    }

    throw error;
  }
}));

// ============================================================
// PATCH /api/bookings/:id — Update booking notes
// Status changes are webhook-only; clients cannot self-confirm.
// ============================================================
bookingsRouter.patch('/:id', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const validation = UpdateBookingSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(422).json({
      error: 'Validation failed',
      message: 'Only the notes field can be updated. Booking status is managed by the payment workflow.',
      details: validation.error.format(),
    });
    return;
  }

  const booking = await prisma.booking.findFirst({
    where: { id, clientId: req.user!.id },
  });

  if (!booking) {
    res.status(404).json({ error: 'Booking not found or access denied' });
    return;
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: validation.data,
  });

  await writeAuditLog('booking', id, 'UPDATED', req.user!.id, {
    fields: Object.keys(validation.data),
  });

  res.json({ data: updated });
}));

// ============================================================
// DELETE /api/bookings/:id — Cancel a booking
// ============================================================
bookingsRouter.delete('/:id', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const booking = await prisma.booking.findFirst({
    where: { id, clientId: req.user!.id },
  });

  if (!booking) {
    res.status(404).json({ error: 'Booking not found or access denied' });
    return;
  }

  if (booking.status === BookingStatus.COMPLETED) {
    res.status(400).json({ error: 'Cannot cancel a completed booking' });
    return;
  }

  // Guarded write: the webhook may move this booking to COMPLETED between
  // the check above and this update. updateMany with a status condition
  // makes the transition atomic.
  const { count } = await prisma.booking.updateMany({
    where: { id, clientId: req.user!.id, status: { not: BookingStatus.COMPLETED } },
    data: { status: BookingStatus.CANCELLED },
  });

  if (count === 0) {
    res.status(409).json({ error: 'Booking can no longer be cancelled' });
    return;
  }

  const cancelled = { ...booking, status: BookingStatus.CANCELLED };

  // Release the slot lock if it exists
  if (booking.lockToken) {
    await releaseSlotLock(booking.startTime, booking.endTime, booking.lockToken);
  }

  await writeAuditLog('booking', id, 'CANCELLED', req.user!.id, {
    previousStatus: booking.status,
  });

  sendBookingStatusEmail(req.user!, cancelled);

  // Notify n8n for cancellation workflow
  notifyN8n('booking-cancelled', {
    bookingId: id,
    event: 'BOOKING_CANCELLED',
    clientEmail: req.user!.email,
    clientName: req.user!.name,
    serviceType: booking.serviceType,
  });

  res.json({ message: 'Booking cancelled successfully.' });
}));
