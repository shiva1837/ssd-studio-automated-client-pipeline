/**
 * SSD Studio — Webhook Routes
 * Handles Stripe payment webhooks and internal n8n webhook auth verification.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { BookingStatus } from '@prisma/client';

export const webhooksRouter = Router();

// ============================================================
// STRIPE WEBHOOK — Payment lifecycle events
// ============================================================

webhooksRouter.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  if (!sig) {
    logger.warn('Stripe webhook received without signature');
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  try {
    // Dynamic import to avoid hard dependency if stripe isn't installed
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' as any });

    const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as any;
        const bookingId = paymentIntent.metadata?.bookingId;

        if (bookingId) {
          const booking = await prisma.booking.update({
            where: { id: bookingId },
            data: {
              status: BookingStatus.CONFIRMED,
              stripePaymentId: paymentIntent.id,
              amountPaid: paymentIntent.amount_received || 0,
              confirmationSentAt: new Date(),
            },
          });

          await prisma.auditLog.create({
            data: {
              entityType: 'booking',
              entityId: bookingId,
              action: 'PAYMENT_CONFIRMED',
              actorId: null,
              metadata: {
                paymentIntentId: paymentIntent.id,
                amountPaid: paymentIntent.amount_received,
              },
            },
          });

          logger.info(`Payment confirmed for booking ${bookingId}`);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as any;
        const bookingId = paymentIntent.metadata?.bookingId;

        if (bookingId) {
          await prisma.auditLog.create({
            data: {
              entityType: 'booking',
              entityId: bookingId,
              action: 'PAYMENT_FAILED',
              actorId: null,
              metadata: {
                paymentIntentId: paymentIntent.id,
                error: paymentIntent.last_payment_error?.message,
              },
            },
          });

          logger.warn(`Payment failed for booking ${bookingId}: ${paymentIntent.last_payment_error?.message}`);
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as any;
        const booking = await prisma.booking.findFirst({
          where: { stripePaymentId: charge.payment_intent },
        });

        if (booking) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { status: BookingStatus.CANCELLED, amountPaid: 0 },
          });

          await prisma.auditLog.create({
            data: {
              entityType: 'booking',
              entityId: booking.id,
              action: 'REFUNDED',
              actorId: null,
              metadata: { chargeId: charge.id, amountRefunded: charge.amount_refunded },
            },
          });

          logger.info(`Refund processed for booking ${booking.id}`);
        }
        break;
      }

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Stripe webhook error:', message);
    res.status(400).json({ error: `Webhook Error: ${message}` });
  }
});

// ============================================================
// INTERNAL: Verify n8n webhook auth (used by n8n workflows calling back)
// ============================================================

export function verifyInternalSecret(req: Request, res: Response, next: () => void): void {
  const provided = req.headers['x-internal-secret'];
  const expected = process.env.N8N_INTERNAL_SECRET;

  if (!expected) {
    logger.error('N8N_INTERNAL_SECRET not configured');
    res.status(500).json({ error: 'Internal secret not configured' });
    return;
  }

  if (provided !== expected) {
    logger.warn('Invalid internal secret on webhook request');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}
