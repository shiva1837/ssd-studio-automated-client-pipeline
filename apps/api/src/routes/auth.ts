import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export const authRouter = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  phone: z.string().min(7).max(20),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const validation = RegisterSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(422).json({ error: 'Validation failed', details: validation.error.format() });
    return;
  }
  const data = validation.data;
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }
  const hashedPassword = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: { email: data.email, name: data.name, phone: data.phone, password: hashedPassword },
    select: { id: true, email: true, name: true, phone: true, createdAt: true },
  });
  const jwtSecret: jwt.Secret = process.env.JWT_SECRET!;
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    jwtSecret,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] }
  );
  logger.info(`User registered: ${user.email}`);
  res.status(201).json({ data: user, token });
}));

authRouter.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const validation = LoginSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(422).json({ error: 'Validation failed', details: validation.error.format() });
    return;
  }
  const data = validation.data;
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !user.password) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const valid = await bcrypt.compare(data.password, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const jwtSecret: jwt.Secret = process.env.JWT_SECRET!;
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    jwtSecret,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] }
  );
  logger.info(`User logged in: ${user.email}`);
  res.json({ data: { id: user.id, email: user.email, name: user.name }, token });
}));

authRouter.get('/me', asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.substring(7);
  let decoded: { sub: string; email: string; name: string };
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; email: string; name: string };
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: decoded.sub }, select: { id: true, email: true, name: true, phone: true } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  res.json({ data: user });
}));
