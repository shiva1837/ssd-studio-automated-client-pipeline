/**
 * SSD Studio — Webhook Routes
 *
 * Three listeners, per the unified lifecycle:
 *   1. POST /api/webhooks/stripe  — payment confirmation (raw body + signature verify)
 *   2. POST /api/webhooks/s3      — S3 object-created events -> presigned URL generation
 *   3. POST /api/webhooks/n8n     — callbacks from n8n notification workflows
 *
 * index.ts mounts express.raw({ type: 'application/json' }) on /api/webhooks
 * specifically so Stripe signature verification receives the unparsed body.
 * The s3 and n8n handlers parse the raw Buffer to JSON themselves and are
 * additionally guarded by a shared-secret header.
 */

import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { BookingStatus, AssetType, DeliveryStatus } from '@prisma/client';
import { generatePresignedUrl } from '../lib/s3';
import { triggerN8nWebhook } from '../lib/n8n';

export const webhooksRouter = Router();

// ============================================================
// Helpers
// ============================================================
function parseRawJson(req: Request): unknown {
  const body = req.body;
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

function verifyInternalSecret(req: Request): boolean {
  const expected = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!expected) return false;
  const provided = req.header('x-internal-secret');
  return provided === expected;
}

// ============================================================
// 1. POST /api/webhooks/stripe — payment confirmation
// ============================================================
webhooksRouter.post('/stripe', asyncHandler(async (req: Request, res: Response) => {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.header('stripe-signature');

  if (!stripeSecret || !webhookSecret || !signature) {
    res.status(400).json({ error: 'Stripe webhook not configured' });
    return;
  }

  const stripe = new Stripe(stripeSecret);
  let event: Stripe.Event;

  try {
    // req.body is the raw Buffer (express.raw mounted in index.ts)
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    logger.warn('Stripe signature verification failed', { err: (err as Error).message });
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const bookingId = intent.metadata?.bookingId;

    if (bookingId) {
      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
          amountPaid: intent.amount_received / 100,
          stripePaymentId: intent.id,
        },
      });
      logger.info(`Payment confirmed for booking ${bookingId}`);

      // Kick off the n8n booking-confirmed lifecycle (calendar + emails + cron)
      await triggerN8nWebhook('booking-confirmed', {
        bookingId: booking.id,
        event: 'PAYMENT_CONFIRMED',
      });
    }
  }

  res.json({ received: true });
}));

// ============================================================
// 2. POST /api/webhooks/s3 — object created -> presigned URL
// ============================================================
webhooksRouter.post('/s3', asyncHandler(async (req: Request, res: Response) => {
  if (!verifyInternalSecret(req)) {
    res.status(401).json({ error: 'Unauthorized webhook' });
    return;
  }

  const payload = parseRawJson(req) as {
    bookingId: string;
    s3ObjectKey: string;
    assetType: keyof typeof AssetType;
  };

  if (!payload?.bookingId || !payload?.s3ObjectKey) {
    res.status(422).json({ error: 'bookingId and s3ObjectKey are required' });
    return;
  }

  const isFinal = payload.assetType === 'FINAL';
  const ttlSeconds = Number(
    isFinal ? process.env.S3_FINAL_URL_TTL || 259200 : process.env.S3_RAW_URL_TTL || 43200
  );
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const presignedUrl = await generatePresignedUrl(payload.s3ObjectKey, ttlSeconds);

  const asset = await prisma.mediaAsset.create({
    data: {
      bookingId: payload.bookingId,
      s3ObjectKey: payload.s3ObjectKey,
      assetType: isFinal ? AssetType.FINAL : AssetType.UNEDITED,
      deliveryStatus: DeliveryStatus.URL_GENERATED,
      presignedUrl,
      expiresAt,
    },
  });

  // Hand off to n8n media-delivery workflow to email the link
  await triggerN8nWebhook('media-ready', {
    mediaAssetId: asset.id,
    bookingId: payload.bookingId,
    assetType: asset.assetType,
    expiresAt: expiresAt.toISOString(),
  });

  logger.info(`Presigned URL generated for asset ${asset.id} (TTL ${ttlSeconds}s)`);
  res.status(201).json({ mediaAssetId: asset.id, expiresAt });
}));

// ============================================================
// 3. POST /api/webhooks/n8n — callbacks from n8n workflows
// ============================================================
webhooksRouter.post('/n8n', asyncHandler(async (req: Request, res: Response) => {
  if (!verifyInternalSecret(req)) {
    res.status(401).json({ error: 'Unauthorized webhook' });
    return;
  }

  const payload = parseRawJson(req) as {
    bookingId: string;
    stage: string;
    sentAt?: string;
  };

  const stageFieldMap: Record<string, string> = {
    CONFIRMATION: 'confirmationSentAt',
    REMINDER_48H: 'reminderSent48hAt',
    REMINDER_24H: 'reminderSent24hAt',
    DAY_OF: 'reminderSentDayOfAt',
    FOLLOW_UP: 'followUpSentAt',
  };

  const field = stageFieldMap[payload.stage];
  if (payload.bookingId && field) {
    await prisma.booking.update({
      where: { id: payload.bookingId },
      data: { [field]: payload.sentAt ? new Date(payload.sentAt) : new Date() },
    });
    logger.info(`n8n stage ${payload.stage} recorded for booking ${payload.bookingId}`);
  }

  res.json({ received: true });
}));

export default webhooksRouter;
