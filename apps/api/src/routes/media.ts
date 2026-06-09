/**
 * SSD Studio — Media Routes
 * Real S3 presigned URL generation: GetObjectCommand for downloads,
 * PutObjectCommand for uploads, signed via @aws-sdk/s3-request-presigner.
 */

import { Router, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { AssetType, DeliveryStatus } from '@prisma/client';

export const mediaRouter = Router();

// Region + credentials come from the standard AWS env vars
// (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) via the default provider chain.
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const DOWNLOAD_URL_EXPIRY = Number(process.env.S3_PRESIGNED_URL_EXPIRY_SECONDS || 86400);
const UPLOAD_URL_EXPIRY = 3600;
const BUCKET_RAW = process.env.S3_BUCKET_RAW || 'ssd-studio-raw-assets';
const BUCKET_FINAL = process.env.S3_BUCKET_FINAL || 'ssd-studio-final-assets';

function bucketForAsset(assetType: AssetType): string {
  return assetType === AssetType.FINAL ? BUCKET_FINAL : BUCKET_RAW;
}

const BookingIdSchema = z.string().uuid();

const UploadUrlSchema = z.object({
  bookingId: z.string().uuid(),
  fileName: z.string().min(1).max(255).regex(/^[^/\\]+$/, 'fileName must not contain path separators'),
  fileType: z.string().min(1).max(100).regex(/^[\w.+-]+\/[\w.+-]+$/, 'fileType must be a valid MIME type'),
  assetType: z.nativeEnum(AssetType).optional().default(AssetType.UNEDITED),
});

const NotifyDeliverySchema = z.object({
  assetId: z.string().uuid(),
});

// ============================================================
// GET /api/media/:bookingId — List media assets for a booking
// Returns fresh presigned download URLs for every asset.
// ============================================================
mediaRouter.get('/:bookingId', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const bookingIdCheck = BookingIdSchema.safeParse(req.params.bookingId);
  if (!bookingIdCheck.success) {
    res.status(400).json({ error: 'bookingId must be a valid UUID' });
    return;
  }
  const bookingId = bookingIdCheck.data;

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientId: req.user!.id },
    include: { mediaAssets: true },
  });

  if (!booking) {
    res.status(404).json({ error: 'Booking not found or access denied' });
    return;
  }

  // Reuse cached presigned URLs while valid; regenerate the rest
  const assetsWithUrls = await Promise.all(
    booking.mediaAssets.map(async (asset) => {
      if (asset.presignedUrl && asset.presignedUrlExpiry && asset.presignedUrlExpiry > new Date()) {
        return asset;
      }

      try {
        const command = new GetObjectCommand({
          Bucket: bucketForAsset(asset.assetType),
          Key: asset.s3ObjectKey,
          ResponseContentDisposition: asset.fileName
            ? `attachment; filename="${asset.fileName}"`
            : undefined,
        });

        const url = await getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_EXPIRY });

        return await prisma.mediaAsset.update({
          where: { id: asset.id },
          data: {
            presignedUrl: url,
            presignedUrlExpiry: new Date(Date.now() + DOWNLOAD_URL_EXPIRY * 1000),
            ...(asset.deliveryStatus === DeliveryStatus.PENDING
              ? { deliveryStatus: DeliveryStatus.URL_GENERATED }
              : {}),
          },
        });
      } catch (error) {
        logger.error(`Failed to generate presigned URL for asset ${asset.id}:`, error);
        return { ...asset, presignedUrl: null, presignedUrlExpiry: null };
      }
    })
  );

  res.json({ data: assetsWithUrls });
}));

// ============================================================
// POST /api/media/upload-url — Presigned PUT URL for uploads
// ============================================================
mediaRouter.post('/upload-url', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validation = UploadUrlSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(422).json({ error: 'Validation failed', details: validation.error.format() });
    return;
  }

  const { bookingId, fileName, fileType, assetType } = validation.data;

  // Verify booking exists and belongs to user
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientId: req.user!.id },
  });

  if (!booking) {
    res.status(404).json({ error: 'Booking not found or access denied' });
    return;
  }

  const key = `${assetType.toLowerCase()}/${bookingId}/${Date.now()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketForAsset(assetType),
    Key: key,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_EXPIRY });

  const asset = await prisma.mediaAsset.create({
    data: {
      bookingId,
      s3ObjectKey: key,
      assetType,
      fileName,
      mimeType: fileType,
    },
  });

  await writeAuditLog('media', asset.id, 'UPLOAD_URL_GENERATED', req.user!.id, {
    bookingId,
    s3ObjectKey: key,
    fileType,
  });

  logger.info(`Presigned upload URL generated for booking ${bookingId}, asset ${asset.id}`);

  res.status(201).json({
    uploadUrl,
    assetId: asset.id,
    expiresIn: UPLOAD_URL_EXPIRY,
  });
}));

// ============================================================
// POST /api/media/notify-delivery — Called when media is delivered
// ============================================================
mediaRouter.post('/notify-delivery', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validation = NotifyDeliverySchema.safeParse(req.body);
  if (!validation.success) {
    res.status(422).json({ error: 'Validation failed', details: validation.error.format() });
    return;
  }

  const { assetId } = validation.data;

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
      deliveryStatus: DeliveryStatus.DELIVERED,
      deliveredAt: new Date(),
      deliveryEmailSent: true,
    },
  });

  await writeAuditLog('media', assetId, 'DELIVERED', req.user!.id, {
    assetType: asset.assetType,
    fileName: asset.fileName,
  });

  res.json({ data: updated });
}));
