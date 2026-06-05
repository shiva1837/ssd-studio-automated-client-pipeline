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
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus } from '@prisma/client';

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

const UpdateBookingSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  notes: z.string().max(1000).optional(),
});

// ============================================================
// DISTRIBUTED LOCK UTILITIES
// ============================================================

const LOCK_TTL_MS = Number(process.env.BOOKING_LOCK_TTL_SECONDS || 300) * 1000;
const LOCK_PREFIX = 'booking:slot:lock:';

/**
 * Acquires a Redis-based distributed slot lock.
 * Returns the lock token if acquired, null if slot is already contested.
 * This is the FIRST defensive layer against double-bookings.
 */
async function acquireSlotLock(startTime: Date, endTime: Date): Promise<string | null> {
  const slotKey = `${LOCK_PREFIX}${startTime.toISOString()}:${endTime.toISOString()}`;
  const lockToken = uuidv4();
  const lockExpiry = Math.ceil(LOCK_TTL_MS / 1000);

  // NX = only set if Not eXists. This is atomic in Redis.
  const result = await redis.set(slotKey, lockToken, 'EX', lockExpiry, 'NX');

  if (result === 'OK') {
    logger.info(`Slot lock acquired: ${slotKey} with token ${lockToken}`);
    return lockToken;
  }

  logger.warn(`Slot lock contested: ${slotKey}`);
  return null;
}

async function releaseSlotLock(startTime: Date, endTime: Date, lockToken: string): Promise<void> {
  const slotKey = `${LOCK_PREFIX}${startTime.toISOString()}:${endTime.toISOString()}`;
  // Only release if we own the lock (compare-and-delete via Lua)
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(luaScript, 1, slotKey, lockToken);
}

// ============================================================
// GET /api/bookings — List bookings for authenticated user
// ============================================================
bookingsRouter.get('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { status, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
  const skip = (pageNum - 1) * limitNum;

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

  // Check for overlapping confirmed/pending bookings
  const conflictingBookings = await prisma.booking.count({
    where: {
      status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      OR: [
        { startTime: { lt: end }, endTime: { gt: start } },
      ],
    },
  });

  const slotKey = `${LOCK_PREFIX}${start.toISOString()}:${end.toISOString()}`;
  const lockExists = await redis.exists(slotKey);

  res.json({
    available: conflictingBookings === 0 && lockExists === 0,
    hasConflict: conflictingBookings > 0,
    hasActiveLock: lockExists === 1,
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
    const booking = await prisma.$transaction(async (tx) => {
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
    }, { isolationLevel: 'Serializable' });

    logger.info(`Booking created: ${booking.id} for user ${req.user!.id}`);

    // Emit webhook to n8n for confirmation email workflow
    // (n8n listens on its webhook endpoint)
    setImmediate(async () => {
      try {
        const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
        if (n8nWebhookUrl) {
          await fetch(`${n8nWebhookUrl}/booking-created`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id, event: 'BOOKING_CREATED' }),
          });
        }
      } catch (err) {
        logger.warn('Failed to notify n8n of new booking:', err);
      }
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
// PATCH /api/bookings/:id — Update booking status/notes
// ============================================================
bookingsRouter.patch('/:id', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const validation = UpdateBookingSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(422).json({ error: 'Validation failed', details: validation.error.format() });
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

  await prisma.booking.update({
    where: { id },
    data: { status: BookingStatus.CANCELLED },
  });

  // Release the slot lock if it exists
  if (booking.lockToken) {
    await releaseSlotLock(booking.startTime, booking.endTime, booking.lockToken);
  }

  // Notify n8n for cancellation workflow
  setImmediate(async () => {
    try {
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
      if (n8nWebhookUrl) {
        await fetch(`${n8nWebhookUrl}/booking-cancelled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: id, event: 'BOOKING_CANCELLED' }),
        });
      }
    } catch (err) {
      logger.warn('Failed to notify n8n of cancellation:', err);
    }
  });

  res.json({ message: 'Booking cancelled successfully.' });
}));
