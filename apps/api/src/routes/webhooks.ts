/**
 * SSD Studio — Stripe Webhook Handler
 * Verifies event signatures against the raw request body and drives booking
 * status transitions. This is the ONLY place bookings move to CONFIRMED;
 * clients cannot self-confirm through the PATCH route.
 *
 * Mounted OUTSIDE the global rate limiter in index.ts — Stripe retries
 * aggressively and rate-limiting its callbacks drops payment events.
 */

import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';
import { sendBookingStatusEmail } from '../lib/email';
import { BookingStatus } from '@prisma/client';

export const webhooksRouter = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

async function handlePaymentSucceeded(paymentIntent: any): Promise<void> {
  const bookingId = paymentIntent.metadata?.bookingId;
  if (!bookingId) {
    logger.warn(`payment_intent.succeeded ${paymentIntent.id} has no bookingId metadata — skipping`);
    return;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { client: { select: { email: true, name: true } } },
  });

  if (!booking) {
    logger.warn(`payment_intent.succeeded ${paymentIntent.id} references unknown booking ${bookingId}`);
    return;
  }

  if (booking.status === BookingStatus.CONFIRMED && booking.stripePaymentId === paymentIntent.id) {
    logger.info(`Booking ${bookingId} already confirmed for ${paymentIntent.id} — idempotent retry, skipping`);
    return;
  }

  // Guarded write: never resurrect a booking the client cancelled (or one
  // already completed) just because a payment event arrived late.
  const { count } = await prisma.booking.updateMany({
    where: { id: bookingId, status: { notIn: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] } },
    data: {
      status: BookingStatus.CONFIRMED,
      stripePaymentId: paymentIntent.id,
      // amount_received is already in cents, matching the Int cents schema
      amountPaid: paymentIntent.amount_received,
      confirmationSentAt: new Date(),
    },
  });

  if (count === 0) {
    logger.warn(
      `Payment ${paymentIntent.id} received for ${booking.status} booking ${bookingId} — status NOT changed, flag for manual refund`
    );
    await writeAuditLog('booking', bookingId, 'PAYMENT_FOR_INACTIVE_BOOKING', null, {
      stripePaymentId: paymentIntent.id,
      bookingStatus: booking.status,
      amountPaidCents: paymentIntent.amount_received,
      source: 'stripe_webhook',
    });
    return;
  }

  const confirmed = {
    ...booking,
    status: BookingStatus.CONFIRMED,
    stripePaymentId: paymentIntent.id,
    amountPaid: paymentIntent.amount_received,
  };

  logger.info(`Booking ${bookingId} CONFIRMED via Stripe payment ${paymentIntent.id}`);

  await writeAuditLog('booking', bookingId, 'CONFIRMED', null, {
    stripePaymentId: paymentIntent.id,
    amountPaidCents: paymentIntent.amount_received,
    source: 'stripe_webhook',
  });

  sendBookingStatusEmail(booking.client, confirmed);
}

async function handlePaymentFailed(paymentIntent: any): Promise<void> {
  const bookingId = paymentIntent.metadata?.bookingId;
  const failureMessage = paymentIntent.last_payment_error?.message || 'Unknown payment failure';

  logger.warn(
    `payment_intent.payment_failed ${paymentIntent.id} (booking: ${bookingId || 'unknown'}): ${failureMessage}`
  );

  if (bookingId) {
    await writeAuditLog('booking', bookingId, 'PAYMENT_FAILED', null, {
      stripePaymentId: paymentIntent.id,
      failureMessage,
      source: 'stripe_webhook',
    });
  }
}

async function handleChargeRefunded(charge: any): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const booking = await prisma.booking.findFirst({
    where: { stripePaymentId: paymentIntentId },
    include: { client: { select: { email: true, name: true } } },
  });

  if (!booking) {
    logger.warn(`charge.refunded ${charge.id} matches no booking (payment ${paymentIntentId})`);
    return;
  }

  // Stripe emits charge.refunded for PARTIAL refunds too; charge.refunded
  // (the boolean field) is only true once the charge is fully refunded.
  if (charge.refunded !== true) {
    logger.info(
      `Partial refund of ${charge.amount_refunded} cents for booking ${booking.id} — status unchanged`
    );
    await writeAuditLog('booking', booking.id, 'PARTIAL_REFUND', null, {
      chargeId: charge.id,
      amountRefundedCents: charge.amount_refunded,
      source: 'stripe_webhook',
    });
    return;
  }

  const cancelled = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.CANCELLED, amountPaid: 0 },
  });

  logger.info(`Refund processed for booking ${booking.id} (charge ${charge.id})`);

  await writeAuditLog('booking', booking.id, 'REFUNDED', null, {
    chargeId: charge.id,
    amountRefundedCents: charge.amount_refunded,
    source: 'stripe_webhook',
  });

  sendBookingStatusEmail(booking.client, cancelled);
}

webhooksRouter.post('/stripe', asyncHandler(async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    logger.error('Stripe webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Stripe is not configured' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event: any;
  try {
    // req.body is the raw Buffer (express.raw is mounted for /api/webhooks)
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed:', err);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;
    default:
      logger.info(`Unhandled Stripe event type: ${event.type}`);
  }

  // Acknowledge verified events so Stripe stops retrying; unknown bookings
  // and duplicate deliveries are logged above rather than 4xx'd into a
  // permanent retry loop.
  res.json({ received: true });
}));
