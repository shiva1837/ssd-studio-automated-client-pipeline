/**
 * SSD Studio — Database Seed
 * Creates sample users, bookings, and media assets for development.
 */

import { PrismaClient, BookingStatus, AssetType, DeliveryStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clean existing data
  await prisma.auditLog.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.user.deleteMany();

  // Create sample users
  const hashedPassword = await bcrypt.hash('password123', 12);

  const user1 = await prisma.user.create({
    data: {
      email: 'alice@example.com',
      name: 'Alice Johnson',
      phone: '+1-555-0101',
      password: hashedPassword,
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'bob@example.com',
      name: 'Bob Martinez',
      phone: '+1-555-0102',
      password: hashedPassword,
    },
  });

  const user3 = await prisma.user.create({
    data: {
      email: 'carol@example.com',
      name: 'Carol Chen',
      phone: '+1-555-0103',
      password: hashedPassword,
    },
  });

  console.log(`Created 3 users: ${user1.email}, ${user2.email}, ${user3.email}`);

  // Create sample bookings
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(12, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(14, 0, 0, 0);
  const nextWeekEnd = new Date(nextWeek);
  nextWeekEnd.setHours(16, 0, 0, 0);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(10, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setHours(12, 0, 0, 0);

  const booking1 = await prisma.booking.create({
    data: {
      clientId: user1.id,
      serviceType: 'PORTRAIT_SESSION',
      startTime: tomorrow,
      endTime: tomorrowEnd,
      status: BookingStatus.CONFIRMED,
      amountPaid: 350.0,
      confirmationSentAt: now,
      notes: 'Outdoor session, golden hour preferred',
      stripePaymentId: 'pi_test_001',
    },
  });

  const booking2 = await prisma.booking.create({
    data: {
      clientId: user2.id,
      serviceType: 'COMMERCIAL_SHOOT',
      startTime: nextWeek,
      endTime: nextWeekEnd,
      status: BookingStatus.PENDING,
      amountPaid: 0,
      notes: 'Product photography for e-commerce catalog',
    },
  });

  const booking3 = await prisma.booking.create({
    data: {
      clientId: user3.id,
      serviceType: 'EVENT_COVERAGE',
      startTime: yesterday,
      endTime: yesterdayEnd,
      status: BookingStatus.COMPLETED,
      amountPaid: 1200.0,
      confirmationSentAt: new Date(yesterday.getTime() - 48 * 60 * 60 * 1000),
      reminderSent48hAt: new Date(yesterday.getTime() - 48 * 60 * 60 * 1000),
      reminderSent24hAt: new Date(yesterday.getTime() - 24 * 60 * 60 * 1000),
      reminderSentDayOfAt: new Date(yesterday.getTime() - 2 * 60 * 60 * 1000),
      followUpSentAt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000),
      stripePaymentId: 'pi_test_002',
    },
  });

  console.log(`Created 3 bookings: ${booking1.id}, ${booking2.id}, ${booking3.id}`);

  // Create sample media assets for the completed booking
  const media1 = await prisma.mediaAsset.create({
    data: {
      bookingId: booking3.id,
      s3ObjectKey: 'raw/event-carol-001/IMG_0001.CR2',
      assetType: AssetType.UNEDITED,
      deliveryStatus: DeliveryStatus.DELIVERED,
      deliveredAt: new Date(yesterday.getTime() + 4 * 60 * 60 * 1000),
      deliveryEmailSent: true,
      fileName: 'IMG_0001.CR2',
      fileSizeBytes: 25_000_000,
      mimeType: 'image/x-canon-cr2',
    },
  });

  const media2 = await prisma.mediaAsset.create({
    data: {
      bookingId: booking3.id,
      s3ObjectKey: 'final/event-carol-001/IMG_0001-edit.jpg',
      assetType: AssetType.FINAL,
      deliveryStatus: DeliveryStatus.DELIVERED,
      deliveredAt: new Date(yesterday.getTime() + 48 * 60 * 60 * 1000),
      deliveryEmailSent: true,
      fileName: 'IMG_0001-edit.jpg',
      fileSizeBytes: 8_000_000,
      mimeType: 'image/jpeg',
    },
  });

  console.log(`Created 2 media assets: ${media1.id}, ${media2.id}`);

  // Create audit log entries
  await prisma.auditLog.createMany({
    data: [
      {
        entityType: 'booking',
        entityId: booking1.id,
        action: 'CREATED',
        actorId: user1.id,
        metadata: { serviceType: 'PORTRAIT_SESSION' },
      },
      {
        entityType: 'booking',
        entityId: booking1.id,
        action: 'CONFIRMED',
        actorId: user1.id,
        metadata: { amountPaid: 350 },
      },
      {
        entityType: 'booking',
        entityId: booking3.id,
        action: 'CREATED',
        actorId: user3.id,
        metadata: { serviceType: 'EVENT_COVERAGE' },
      },
      {
        entityType: 'booking',
        entityId: booking3.id,
        action: 'COMPLETED',
        actorId: user3.id,
        metadata: { totalMedia: 2 },
      },
      {
        entityType: 'media',
        entityId: media2.id,
        action: 'DELIVERED',
        actorId: null,
        metadata: { assetType: 'FINAL', deliveryEmailSent: true },
      },
    ],
  });

  console.log('Created 5 audit log entries');
  console.log('Seed complete!');
  console.log('');
  console.log('Login credentials:');
  console.log('  alice@example.com / password123');
  console.log('  bob@example.com / password123');
  console.log('  carol@example.com / password123');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
