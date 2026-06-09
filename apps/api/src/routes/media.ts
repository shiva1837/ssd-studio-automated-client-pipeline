/**
 * SSD Studio — Media Routes
 * Handles S3 presigned URL generation for secure media upload/download.
 */

import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export const mediaRouter = Router();

// ============================================================
// S3 CLIENT (lazy init)
// ============================================================

function getS3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
}

const PRESIGNED_URL_EXPIRY = Number(process.env.S3_PRESIGNED_URL_EXPIRY_SECONDS || 86400);

// ============================================================
// GET /api/media/:bookingId — List media assets for a booking
// ============================================================
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

  // Generate fresh presigned download URLs for each asset
  const assetsWithUrls = await Promise.all(
    booking.mediaAssets.map(async (asset) => {
      if (asset.presignedUrl && asset.presignedUrlExpiry && asset.presignedUrlExpiry > new Date()) {
        return asset; // URL still valid
      }

      try {
        const s3 = getS3Client();
        const bucket = asset.assetType === 'FINAL'
          ? process.env.S3_BUCKET_FINAL
          : process.env.S3_BUCKET_RAW;

        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: asset.s3ObjectKey,
        });

        const url = await getSignedUrl(s3, command, { expiresIn: PRESIGNED_URL_EXPIRY });

        // Cache the URL
        const updated = await prisma.mediaAsset.update({
          where: { id: asset.id },
          data: {
            presignedUrl: url,
            presignedUrlExpiry: new Date(Date.now() + PRESIGNED_URL_EXPIRY * 1000),
          },
        });

        return updated;
      } catch (error) {
        logger.error(`Failed to generate presigned URL for asset ${asset.id}:`, error);
        return { ...asset, presignedUrl: null, presignedUrlExpiry: null };
      }
    })
  );

  res.json({ data: assetsWithUrls });
}));

// ============================================================
// POST /api/media/upload-url — Generate presigned URL for upload
// ============================================================
mediaRouter.post('/upload-url', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { bookingId, fileName, fileType, assetType } = req.body;

  if (!bookingId || !fileName || !fileType) {
    res.status(400).json({ error: 'bookingId, fileName, and fileType are required' });
    return;
  }

  // Verify booking exists and belongs to user
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientId: req.user!.id },
  });

  if (!booking) {
    res.status(404).json({ error: 'Booking not found or access denied' });
    return;
  }

  const bucket = assetType === 'FINAL'
    ? process.env.S3_BUCKET_FINAL
    : process.env.S3_BUCKET_RAW;

  if (!bucket) {
    res.status(500).json({ error: 'S3 bucket not configured' });
    return;
  }

  const key = `${assetType?.toLowerCase() || 'raw'}/${bookingId}/${Date.now()}-${fileName}`;

  try {
    const s3 = getS3Client();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour for upload

    // Create media asset record
    const asset = await prisma.mediaAsset.create({
      data: {
        bookingId,
        s3ObjectKey: key,
        assetType: assetType || 'UNEDITED',
        fileName,
        mimeType: fileType,
      },
    });

    logger.info(`Presigned upload URL generated for booking ${bookingId}, asset ${asset.id}`);

    res.json({
      uploadUrl,
      assetId: asset.id,
      expiresIn: 3600,
    });
  } catch (error) {
    logger.error('Failed to generate presigned upload URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
}));

// ============================================================
// POST /api/media/notify-delivery — Called when media is delivered
// ============================================================
mediaRouter.post('/notify-delivery', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { assetId } = req.body;

  if (!assetId) {
    res.status(400).json({ error: 'assetId is required' });
    return;
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId },
    include: { booking: true },
  });

  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  // Verify the asset belongs to the user's booking
  if (asset.booking.clientId !== req.user!.id) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      deliveryStatus: 'DELIVERED',
      deliveredAt: new Date(),
      deliveryEmailSent: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'media',
      entityId: assetId,
      action: 'DELIVERED',
      actorId: req.user!.id,
      metadata: { assetType: asset.assetType, fileName: asset.fileName },
    },
  });

  res.json({ data: updated });
}));
