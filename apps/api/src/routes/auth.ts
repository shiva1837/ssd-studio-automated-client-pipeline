/**
 * SSD Studio — Authentication Routes
 * JWT-based auth: register, login, and current-user (\/me).
 * Passwords hashed with bcrypt; tokens signed with JWT_SECRET.
 *
 * NOTE: User.passwordHash is added to the Prisma schema in Step 2.
 */

import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

export const authRouter = Router();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ============================================================
// VALIDATION SCHEMAS
// ============================================================
const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(20),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

// ============================================================
// TOKEN HELPER
// ============================================================
function signToken(user: { id: string; email: string; name: string }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError('JWT_SECRET is not configured', 500, 'CONFIG_ERROR');
  }
  const payload = { sub: user.id, email: user.email, name: user.name };
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

// ============================================================
// POST /api/auth/register
// ============================================================
authRouter.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const parsed = RegisterSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(parsed.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: parsed.email,
      name: parsed.name,
      phone: parsed.phone,
      // @ts-expect-error passwordHash added to schema in Step 2
      passwordHash,
    },
    select: { id: true, email: true, name: true, phone: true, createdAt: true },
  });

  logger.info(`New user registered: ${user.id}`);
  const token = signToken(user);
  res.status(201).json({ user, token });
}));

// ============================================================
// POST /api/auth/login
// ============================================================
authRouter.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const parsed = LoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: parsed.email } });
  // @ts-expect-error passwordHash added to schema in Step 2
  if (!user || !user.passwordHash) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // @ts-expect-error passwordHash added to schema in Step 2
  const valid = await bcrypt.compare(parsed.password, user.passwordHash);
  if (!valid) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const token = signToken(user);
  res.json({
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
    token,
  });
}));

// ============================================================
// GET /api/auth/me — current authenticated user
// ============================================================
authRouter.get('/me', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true, phone: true, createdAt: true },
  });
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  res.json({ user });
}));

export default authRouter;
