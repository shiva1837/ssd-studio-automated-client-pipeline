/**
 * SSD Studio — Media Routes
 * Lets authenticated clients list their media assets and regenerate
 * a fresh presigned download URL when an existing one has expired.
 */

import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { generatePresignedUrl } from '../lib/s3';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { AssetType, DeliveryStatus } from '@prisma/client';

export const mediaRouter = Router();

// ============================================================
// GET /api/media/booking/:bookingId — list assets for a booking
// ============================================================
mediaRouter.get('/booking/:bookingId', requireAuth, asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;

    // Ownership check: booking must belong to the requesting user
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, clientId: req.user!.id },
      select: { id: true },
    });
    if (!booking) {
      throw new AppError('Booking not found or access denied', 404, 'BOOKING_NOT_FOUND');
    }

    const assets = await prisma.mediaAsset.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: assets });
  }
));

// ============================================================
// POST /api/media/:assetId/refresh-url — regenerate presigned URL
// ============================================================
mediaRouter.post('/:assetId/refresh-url', requireAuth, asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { assetId } = req.params;

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      include: { booking: { select: { clientId: true } } },
    });

    if (!asset || asset.booking.clientId !== req.user!.id) {
      throw new AppError('Media asset not found or access denied', 404, 'ASSET_NOT_FOUND');
    }

    const isFinal = asset.assetType === AssetType.FINAL;
    const ttlSeconds = Number(
      isFinal ? process.env.S3_FINAL_URL_TTL || 259200 : process.env.S3_RAW_URL_TTL || 43200
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const presignedUrl = await generatePresignedUrl(asset.s3ObjectKey, ttlSeconds);

    const updated = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { presignedUrl, expiresAt, deliveryStatus: DeliveryStatus.URL_GENERATED },
    });

    logger.info(`Refreshed presigned URL for asset ${assetId}`);
    res.json({ data: { id: updated.id, presignedUrl, expiresAt } });
  }
));

export default mediaRouter;
