/**
 * SSD Studio — Booking Routes
 *
 * Double-booking prevention is enforced purely at the database level:
 *   - A PostgreSQL SERIALIZABLE transaction re-checks for overlapping
 *     slots immediately before insert.
 *   - A DB unique constraint on (startTime, endTime) for active bookings
 *     (see Prisma schema) is the final backstop.
 * No application-level / Redis locking is used.
 */

import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { triggerN8nWebhook } from '../lib/n8n';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
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

const UpdateBookingSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  notes: z.string().max(1000).optional(),
});

const ACTIVE_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
const MAX_SERIALIZATION_RETRIES = 3;

// ============================================================
// GET /api/bookings — list bookings for authenticated user
// ============================================================
bookingsRouter.get('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { status, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.BookingWhereInput = {
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
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
}));

// ============================================================
// GET /api/bookings/availability — check slot availability
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

  const conflicting = await prisma.booking.count({
    where: {
      status: { in: ACTIVE_STATUSES },
      startTime: { lt: end },
      endTime: { gt: start },
    },
  });

  res.json({
    available: conflicting === 0,
    hasConflict: conflicting > 0,
    requestedSlot: { startTime: start, endTime: end },
  });
}));

// ============================================================
// POST /api/bookings — reserve a booking slot
// Double-booking prevention via SERIALIZABLE transaction.
// ============================================================
bookingsRouter.post('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { serviceType, notes, startTime: startRaw, endTime: endRaw } =
    CreateBookingSchema.parse(req.body);

  const startTime = new Date(startRaw);
  const endTime = new Date(endRaw);

  if (endTime <= startTime) {
    throw new AppError('endTime must be after startTime', 400, 'INVALID_RANGE');
  }
  if (startTime < new Date()) {
    throw new AppError('Cannot book a slot in the past', 400, 'PAST_SLOT');
  }

  // Retry loop to tolerate serialization failures (Postgres error 40001)
  let booking;
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt++) {
    try {
      booking = await prisma.$transaction(async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            status: { in: ACTIVE_STATUSES },
            startTime: { lt: endTime },
            endTime: { gt: startTime },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new AppError('This slot was just booked. Please choose another time.', 409, 'SLOT_CONFLICT');
        }
        return tx.booking.create({
          data: {
            clientId: req.user!.id,
            serviceType,
            startTime,
            endTime,
            status: BookingStatus.PENDING,
            notes,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break; // success
    } catch (err) {
      // Retry only on serialization failures; rethrow everything else
      const isSerialization =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (isSerialization && attempt < MAX_SERIALIZATION_RETRIES) {
        logger.warn(`Serialization conflict on booking attempt ${attempt}; retrying`);
        continue;
      }
      throw err;
    }
  }

  logger.info(`Booking created: ${booking!.id} for user ${req.user!.id}`);

  // Hand off to the n8n booking-created lifecycle (calendar + confirmation + cron)
  void triggerN8nWebhook('booking-created', { bookingId: booking!.id, event: 'BOOKING_CREATED' });

  res.status(201).json({ data: booking, message: 'Booking reserved successfully.' });
}));

// ============================================================
// PATCH /api/bookings/:id — update status/notes
// ============================================================
bookingsRouter.patch('/:id', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = UpdateBookingSchema.parse(req.body);

  const booking = await prisma.booking.findFirst({ where: { id, clientId: req.user!.id } });
  if (!booking) {
    throw new AppError('Booking not found or access denied', 404, 'BOOKING_NOT_FOUND');
  }

  const updated = await prisma.booking.update({ where: { id }, data });
  res.json({ data: updated });
}));

// ============================================================
// DELETE /api/bookings/:id — cancel a booking
// ============================================================
bookingsRouter.delete('/:id', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const booking = await prisma.booking.findFirst({ where: { id, clientId: req.user!.id } });
  if (!booking) {
    throw new AppError('Booking not found or access denied', 404, 'BOOKING_NOT_FOUND');
  }
  if (booking.status === BookingStatus.COMPLETED) {
    throw new AppError('Cannot cancel a completed booking', 400, 'ALREADY_COMPLETED');
  }

  await prisma.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED } });
  void triggerN8nWebhook('booking-cancelled', { bookingId: id, event: 'BOOKING_CANCELLED' });

  res.json({ message: 'Booking cancelled successfully.' });
}));

export default bookingsRouter;
