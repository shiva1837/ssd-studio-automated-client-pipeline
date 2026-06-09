import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export const mediaRouter = Router();

// GET /api/media/:bookingId — list media assets for a booking
mediaRouter.get('/:bookingId', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { bookingId } = req.params;
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientId: req.user!.id },
    include: { mediaAssets: true },
  });
  if (!booking) {
    res.status(404).json({ error: 'Booking not found or access denied' });
    return;
  }
  res.json({ data: booking.mediaAssets });
}));

// POST /api/media/upload-url — generate presigned URL stub
mediaRouter.post('/upload-url', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { bookingId, fileName, fileType } = req.body;
  logger.info('Presigned URL requested', { bookingId, fileName });
  // TODO: Implement actual S3 presigned URL generation
  res.json({ uploadUrl: null, message: 'S3 not configured — set AWS credentials in .env' });
}));
