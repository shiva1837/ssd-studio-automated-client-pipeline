/**
 * SSD Studio — Analytics Routes
 * Revenue, booking counts, conversion metrics.
 */

import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus } from '@prisma/client';

export const analyticsRouter = Router();

// ============================================================
// GET /api/analytics — Dashboard analytics
// ============================================================
analyticsRouter.get('/', requireAuth, asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const [
    totalBookings,
    byStatus,
    revenue,
    byService,
    upcomingBookings,
  ] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.booking.aggregate({
      _sum: { amountPaid: true },
      _avg: { amountPaid: true },
      _count: { amountPaid: true },
      where: { status: { not: BookingStatus.CANCELLED } },
    }),
    prisma.booking.groupBy({
      by: ['serviceType'],
      _count: { serviceType: true },
      _sum: { amountPaid: true },
      where: { status: { not: BookingStatus.CANCELLED } },
      orderBy: { _count: { serviceType: 'desc' } },
    }),
    prisma.booking.count({
      where: {
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        startTime: { gt: new Date() },
      },
    }),
  ]);

  // All monetary values are in cents, matching the amountPaid Int column
  res.json({
    totalBookings,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.status])),
    totalRevenue: revenue._sum.amountPaid ?? 0,
    avgBookingValue: Math.round(revenue._avg.amountPaid ?? 0),
    byService: byService.map((s) => ({
      serviceType: s.serviceType,
      count: s._count.serviceType,
      revenue: s._sum.amountPaid ?? 0,
    })),
    upcomingBookings,
  });
}));
