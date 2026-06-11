/**
 * Booking route tests — create, list, update, cancel.
 * Prisma, Redis, email, and audit are mocked; auth runs for real against
 * the mocked user lookup. Mounts the router on a bare express app —
 * importing ../index would call app.listen() and leak an open handle.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    booking: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/redis', () => ({
  redis: {
    set: jest.fn(),
    eval: jest.fn(),
    exists: jest.fn(),
  },
}));

jest.mock('../lib/email', () => ({
  sendBookingCreatedEmail: jest.fn(),
  sendBookingStatusEmail: jest.fn(),
}));

jest.mock('../lib/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { sendBookingCreatedEmail, sendBookingStatusEmail } from '../lib/email';
import { writeAuditLog } from '../lib/audit';
import { bookingsRouter } from '../routes/bookings';

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  booking: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};
const mockedRedis = redis as unknown as { set: jest.Mock; eval: jest.Mock; exists: jest.Mock };

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);
// Mirror of the production error handler so thrown errors do not hang requests
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: 'Internal server error' });
});

const JWT_SECRET = process.env.JWT_SECRET!;

const USER = {
  id: '7f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
  email: 'alice@example.com',
  name: 'Alice Johnson',
};

const AUTH = `Bearer ${jwt.sign({ sub: USER.id, email: USER.email, name: USER.name }, JWT_SECRET)}`;

// Far-future fixed slot keeps "past booking" checks deterministic
const START = new Date('2030-06-01T10:00:00.000Z');
const END = new Date('2030-06-01T11:00:00.000Z');

const BOOKING = {
  id: 'b1d2c3e4-f5a6-4789-8abc-def012345678',
  clientId: USER.id,
  serviceType: 'PORTRAIT_SESSION',
  startTime: START,
  endTime: END,
  status: 'PENDING',
  amountPaid: 0,
  notes: null,
  lockToken: 'lock-token-1',
};

beforeEach(() => {
  mockedPrisma.user.findUnique.mockResolvedValue(USER);
  mockedRedis.eval.mockResolvedValue(1);
  mockedRedis.exists.mockResolvedValue(0);
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe('GET /api/bookings', () => {
  it('returns bookings with pagination metadata', async () => {
    mockedPrisma.booking.findMany.mockResolvedValue([BOOKING]);
    mockedPrisma.booking.count.mockResolvedValue(1);

    const res = await request(app).get('/api/bookings').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('falls back to sane pagination for non-numeric query params (NaN guard)', async () => {
    mockedPrisma.booking.findMany.mockResolvedValue([]);
    mockedPrisma.booking.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/bookings?page=abc&limit=xyz')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
    expect(mockedPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    );
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid status filter with 400 instead of a Prisma 500', async () => {
    const res = await request(app)
      .get('/api/bookings?status=BOGUS')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(mockedPrisma.booking.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/bookings', () => {
  const payload = {
    serviceType: 'PORTRAIT_SESSION',
    startTime: START.toISOString(),
    endTime: END.toISOString(),
    notes: 'Test session',
  };

  function mockTransactionSuccess() {
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        booking: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(BOOKING),
        },
      })
    );
  }

  it('creates a booking when the slot is free', async () => {
    mockedRedis.set.mockResolvedValue('OK');
    mockTransactionSuccess();

    const res = await request(app).post('/api/bookings').set('Authorization', AUTH).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(BOOKING.id);
    expect(sendBookingCreatedEmail).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      'booking', BOOKING.id, 'CREATED', USER.id, expect.any(Object)
    );
  });

  it('locks the discretized hour bucket, not the exact range', async () => {
    mockedRedis.set.mockResolvedValue('OK');
    mockTransactionSuccess();

    // 10:30-11:30 must lock BOTH the 10:00 and 11:00 buckets
    await request(app).post('/api/bookings').set('Authorization', AUTH).send({
      ...payload,
      startTime: new Date('2030-06-01T10:30:00.000Z').toISOString(),
      endTime: new Date('2030-06-01T11:30:00.000Z').toISOString(),
    });

    const lockedKeys = mockedRedis.set.mock.calls.map((call) => call[0]);
    expect(lockedKeys).toEqual([
      'booking:slot:lock:2030-06-01T10:00:00.000Z',
      'booking:slot:lock:2030-06-01T11:00:00.000Z',
    ]);
  });

  it('returns 409 SLOT_LOCKED when the Redis lock is contested', async () => {
    mockedRedis.set.mockResolvedValue(null);

    const res = await request(app).post('/api/bookings').set('Authorization', AUTH).send(payload);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_LOCKED');
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 409 SLOT_CONFLICT when an overlapping booking exists in the DB', async () => {
    mockedRedis.set.mockResolvedValue('OK');
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        booking: {
          findFirst: jest.fn().mockResolvedValue(BOOKING),
          create: jest.fn(),
        },
      })
    );

    const res = await request(app).post('/api/bookings').set('Authorization', AUTH).send(payload);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_CONFLICT');
    // The contested lock must be rolled back
    expect(mockedRedis.eval).toHaveBeenCalled();
  });

  it('rejects invalid payloads with 422', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', AUTH)
      .send({ serviceType: '', startTime: 'not-a-date', endTime: 'not-a-date' });

    expect(res.status).toBe(422);
  });

  it('rejects bookings in the past with 400', async () => {
    const res = await request(app).post('/api/bookings').set('Authorization', AUTH).send({
      ...payload,
      startTime: '2020-01-01T10:00:00.000Z',
      endTime: '2020-01-01T11:00:00.000Z',
    });

    expect(res.status).toBe(400);
  });

  it('rejects endTime before startTime with 400', async () => {
    const res = await request(app).post('/api/bookings').set('Authorization', AUTH).send({
      ...payload,
      startTime: END.toISOString(),
      endTime: START.toISOString(),
    });

    expect(res.status).toBe(400);
  });

  it('rejects ranges longer than the duration cap (Redis key-explosion guard)', async () => {
    const res = await request(app).post('/api/bookings').set('Authorization', AUTH).send({
      ...payload,
      startTime: START.toISOString(),
      endTime: new Date('2031-06-01T10:00:00.000Z').toISOString(), // one year
    });

    expect(res.status).toBe(400);
    expect(mockedRedis.set).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/bookings/:id', () => {
  it('updates notes on an owned booking', async () => {
    mockedPrisma.booking.findFirst.mockResolvedValue(BOOKING);
    mockedPrisma.booking.update.mockResolvedValue({ ...BOOKING, notes: 'Updated' });

    const res = await request(app)
      .patch(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH)
      .send({ notes: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Updated');
    expect(writeAuditLog).toHaveBeenCalledWith(
      'booking', BOOKING.id, 'UPDATED', USER.id, expect.any(Object)
    );
  });

  it('rejects client status changes with 422 (webhook-only transition)', async () => {
    const res = await request(app)
      .patch(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH)
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(422);
    expect(mockedPrisma.booking.update).not.toHaveBeenCalled();
  });

  it('returns 404 for bookings the user does not own', async () => {
    mockedPrisma.booking.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH)
      .send({ notes: 'Updated' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/bookings/:id', () => {
  it('cancels an owned booking, releases the lock, and notifies', async () => {
    mockedPrisma.booking.findFirst.mockResolvedValue(BOOKING);
    mockedPrisma.booking.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(mockedPrisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } })
    );
    // Lock release runs the compare-and-delete Lua script
    expect(mockedRedis.eval).toHaveBeenCalled();
    expect(sendBookingStatusEmail).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      'booking', BOOKING.id, 'CANCELLED', USER.id, expect.any(Object)
    );
  });

  it('refuses to cancel a completed booking', async () => {
    mockedPrisma.booking.findFirst.mockResolvedValue({ ...BOOKING, status: 'COMPLETED' });

    const res = await request(app)
      .delete(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(mockedPrisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when the booking completes between check and write (race guard)', async () => {
    mockedPrisma.booking.findFirst.mockResolvedValue(BOOKING);
    mockedPrisma.booking.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .delete(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(409);
    expect(sendBookingStatusEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for bookings the user does not own', async () => {
    mockedPrisma.booking.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/bookings/${BOOKING.id}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });
});
