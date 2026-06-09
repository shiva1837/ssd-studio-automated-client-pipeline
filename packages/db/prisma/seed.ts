/**
 * SSD Studio — Database Seed
 * Creates sample users, bookings, and media assets for development.
 * amountPaid is stored in cents (Int) to avoid floating point errors.
 */

import { PrismaClient, BookingStatus, AssetType, DeliveryStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  await prisma.auditLog.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.user.deleteMany();

  const hp = await bcrypt.hash('password123', 12);

  // ── 5 Users ──────────────────────────────────────────────
  const users = await Promise.all([
    prisma.user.create({ data: { email: 'alice@example.com', name: 'Alice Johnson', phone: '+1-555-0101', password: hp } }),
    prisma.user.create({ data: { email: 'bob@example.com', name: 'Bob Martinez', phone: '+1-555-0102', password: hp } }),
    prisma.user.create({ data: { email: 'carol@example.com', name: 'Carol Chen', phone: '+1-555-0103', password: hp } }),
    prisma.user.create({ data: { email: 'dave@example.com', name: 'Dave Patel', phone: '+1-555-0104', password: hp } }),
    prisma.user.create({ data: { email: 'emma@example.com', name: 'Emma Wilson', phone: '+1-555-0105', password: hp } }),
  ]);
  console.log(`Created ${users.length} users`);

  const now = new Date();
  const d = (offsetDays: number, hour: number, min = 0) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + offsetDays);
    dt.setHours(hour, min, 0, 0);
    return dt;
  };

  // ── 12 Bookings across all statuses ──────────────────────
  const bookings = await Promise.all([
    // CONFIRMED future bookings
    prisma.booking.create({ data: { clientId: users[0].id, serviceType: 'PORTRAIT_SESSION', startTime: d(1, 10), endTime: d(1, 12), status: BookingStatus.CONFIRMED, amountPaid: 35000, confirmationSentAt: now, stripePaymentId: 'pi_test_001', notes: 'Outdoor golden hour' } }),
    prisma.booking.create({ data: { clientId: users[1].id, serviceType: 'COMMERCIAL_SHOOT', startTime: d(3, 14), endTime: d(3, 17), status: BookingStatus.CONFIRMED, amountPaid: 250000, confirmationSentAt: now, stripePaymentId: 'pi_test_002', notes: 'Product catalog for e-commerce' } }),
    prisma.booking.create({ data: { clientId: users[2].id, serviceType: 'BRAND_CAMPAIGN', startTime: d(5, 9), endTime: d(5, 13), status: BookingStatus.CONFIRMED, amountPaid: 500000, confirmationSentAt: now, stripePaymentId: 'pi_test_003' } }),
    prisma.booking.create({ data: { clientId: users[3].id, serviceType: 'VIDEO_PRODUCTION', startTime: d(7, 11), endTime: d(7, 15), status: BookingStatus.CONFIRMED, amountPaid: 800000, confirmationSentAt: now, stripePaymentId: 'pi_test_004', notes: 'Documentary short film' } }),
    // PENDING bookings (not yet paid)
    prisma.booking.create({ data: { clientId: users[4].id, serviceType: 'EVENT_COVERAGE', startTime: d(10, 16), endTime: d(10, 20), status: BookingStatus.PENDING, amountPaid: 0, notes: 'Music festival coverage' } }),
    prisma.booking.create({ data: { clientId: users[0].id, serviceType: 'PRODUCT_PHOTOGRAPHY', startTime: d(14, 10), endTime: d(14, 12), status: BookingStatus.PENDING, amountPaid: 0 } }),
    prisma.booking.create({ data: { clientId: users[1].id, serviceType: 'PORTRAIT_SESSION', startTime: d(21, 13), endTime: d(21, 14), status: BookingStatus.PENDING, amountPaid: 0, notes: 'Headshots for LinkedIn' } }),
    // COMPLETED past bookings
    prisma.booking.create({ data: { clientId: users[2].id, serviceType: 'EVENT_COVERAGE', startTime: d(-7, 18), endTime: d(-7, 22), status: BookingStatus.COMPLETED, amountPaid: 120000, confirmationSentAt: d(-8, 10), stripePaymentId: 'pi_test_005', followUpSentAt: d(-5, 10) } }),
    prisma.booking.create({ data: { clientId: users[3].id, serviceType: 'PORTRAIT_SESSION', startTime: d(-14, 10), endTime: d(-14, 11), status: BookingStatus.COMPLETED, amountPaid: 25000, confirmationSentAt: d(-15, 10), stripePaymentId: 'pi_test_006' } }),
    prisma.booking.create({ data: { clientId: users[4].id, serviceType: 'COMMERCIAL_SHOOT', startTime: d(-21, 14), endTime: d(-21, 18), status: BookingStatus.COMPLETED, amountPaid: 350000, confirmationSentAt: d(-22, 10), stripePaymentId: 'pi_test_007' } }),
    // CANCELLED bookings
    prisma.booking.create({ data: { clientId: users[0].id, serviceType: 'EVENT_COVERAGE', startTime: d(-3, 10), endTime: d(-3, 14), status: BookingStatus.CANCELLED, amountPaid: 0, notes: 'Client rescheduled, no refund needed' } }),
    prisma.booking.create({ data: { clientId: users[1].id, serviceType: 'BRAND_CAMPAIGN', startTime: d(30, 9), endTime: d(30, 17), status: BookingStatus.CANCELLED, amountPaid: 0, notes: 'Campaign put on hold' } }),
  ]);
  console.log(`Created ${bookings.length} bookings`);

  // ── 6 Media assets on completed bookings ──────────────────
  const assets = await Promise.all([
    prisma.mediaAsset.create({ data: { bookingId: bookings[7].id, s3ObjectKey: 'raw/event-carol-001/IMG_0001.CR2', assetType: AssetType.UNEDITED, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: d(-7, 14), deliveryEmailSent: true, fileName: 'IMG_0001.CR2', fileSizeBytes: 25000000, mimeType: 'image/x-canon-cr2' } }),
    prisma.mediaAsset.create({ data: { bookingId: bookings[7].id, s3ObjectKey: 'final/event-carol-001/IMG_0001.jpg', assetType: AssetType.FINAL, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: d(-5, 10), deliveryEmailSent: true, fileName: 'IMG_0001.jpg', fileSizeBytes: 8000000, mimeType: 'image/jpeg' } }),
    prisma.mediaAsset.create({ data: { bookingId: bookings[7].id, s3ObjectKey: 'final/event-carol-001/IMG_0042.jpg', assetType: AssetType.FINAL, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: d(-5, 10), deliveryEmailSent: true, fileName: 'IMG_0042.jpg', fileSizeBytes: 7500000, mimeType: 'image/jpeg' } }),
    prisma.mediaAsset.create({ data: { bookingId: bookings[8].id, s3ObjectKey: 'final/portrait-dave-001/headshot_001.jpg', assetType: AssetType.FINAL, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: d(-12, 15), deliveryEmailSent: true, fileName: 'headshot_001.jpg', fileSizeBytes: 5000000, mimeType: 'image/jpeg' } }),
    prisma.mediaAsset.create({ data: { bookingId: bookings[9].id, s3ObjectKey: 'raw/commercial-emma-001/IMG_1001.CR2', assetType: AssetType.UNEDITED, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: d(-20, 12), deliveryEmailSent: true, fileName: 'IMG_1001.CR2', fileSizeBytes: 28000000, mimeType: 'image/x-canon-cr2' } }),
    prisma.mediaAsset.create({ data: { bookingId: bookings[9].id, s3ObjectKey: 'final/commercial-emma-001/product_001.jpg', assetType: AssetType.FINAL, deliveryStatus: DeliveryStatus.DELIVERED, deliveredAt: d(-19, 10), deliveryEmailSent: true, fileName: 'product_001.jpg', fileSizeBytes: 6000000, mimeType: 'image/jpeg' } }),
  ]);
  console.log(`Created ${assets.length} media assets`);

  // ── Audit log entries ────────────────────────────────────
  await prisma.auditLog.createMany({
    data: bookings.map((b) => ({
      entityType: 'booking',
      entityId: b.id,
      action: b.status === 'CANCELLED' ? 'CANCELLED' : 'CREATED',
      actorId: b.clientId,
      metadata: { serviceType: b.serviceType, amountPaid: b.amountPaid },
    })),
  });
  console.log(`Created ${bookings.length} audit log entries`);

  console.log('\nSeed complete!');
  console.log('\nLogin credentials (all use password: password123):');
  users.forEach((u) => console.log(`  ${u.email}`));
}

main()
  .catch((e) => { console.error('Seed error:', e); process.exit(1); })
  .finally(async () => await prisma.$disconnect());
