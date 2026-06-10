/**
 * Auth route tests — register, login, getMe.
 * Prisma is mocked; bcrypt and jwt run for real against test fixtures.
 * Mounts the router on a bare express app — importing ../index would
 * call app.listen() and leak an open handle into the test run.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { authRouter } from '../routes/auth';

const mockedPrisma = prisma as unknown as {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const JWT_SECRET = process.env.JWT_SECRET!;

// Low cost factor keeps the test fast; the route only compares against it
const PASSWORD = 'password123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const USER = {
  id: '7f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
  email: 'alice@example.com',
  name: 'Alice Johnson',
  phone: '+1-555-0101',
};

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ ...USER, createdAt: new Date() });

    const res = await request(app).post('/api/auth/register').send({
      email: USER.email,
      name: USER.name,
      phone: USER.phone,
      password: PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(USER.email);
    expect(res.body.token).toBeDefined();

    const decoded = jwt.verify(res.body.token, JWT_SECRET) as { sub: string };
    expect(decoded.sub).toBe(USER.id);

    // Password must be hashed before storage
    const createArgs = mockedPrisma.user.create.mock.calls[0][0];
    expect(createArgs.data.password).not.toBe(PASSWORD);
  });

  it('rejects duplicate emails with 409', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(USER);

    const res = await request(app).post('/api/auth/register').send({
      email: USER.email,
      name: USER.name,
      phone: USER.phone,
      password: PASSWORD,
    });

    expect(res.status).toBe(409);
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads with 422 and field details', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'not-an-email',
      name: '',
      phone: '123',
      password: 'short',
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.email).toBeDefined();
    expect(res.body.details.password).toBeDefined();
  });
});

describe('POST /api/auth/login', () => {
  it('returns user data and a token for valid credentials', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...USER, password: PASSWORD_HASH });

    const res = await request(app).post('/api/auth/login').send({
      email: USER.email,
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(USER.id);
    expect(res.body.data).not.toHaveProperty('password');

    const decoded = jwt.verify(res.body.token, JWT_SECRET) as { sub: string };
    expect(decoded.sub).toBe(USER.id);
  });

  it('rejects a wrong password with 401', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...USER, password: PASSWORD_HASH });

    const res = await request(app).post('/api/auth/login').send({
      email: USER.email,
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('rejects an unknown email with 401', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: PASSWORD,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects invalid payloads with 422', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'bad' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(USER);
    const token = jwt.sign({ sub: USER.id, email: USER.email, name: USER.name }, JWT_SECRET);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(USER.id);
  });

  it('rejects requests without an Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token with 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects a valid token whose user no longer exists', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const token = jwt.sign({ sub: USER.id, email: USER.email, name: USER.name }, JWT_SECRET);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
