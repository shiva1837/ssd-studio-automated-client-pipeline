/**
 * SSD Studio — Global Error Handler Middleware
 * Normalizes Prisma, Zod, JWT, and generic errors into consistent JSON responses.
 * Persists server-side errors to the SystemLogs table for the resilience layer.
 */

import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export class AppError extends Error {
  statusCode: number;
  code?: string;
  isOperational: boolean;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Best-effort persistence of an error to SystemLogs.
 * Never throws — logging failures must not mask the original error.
 */
async function persistSystemLog(level: string, message: string, context: unknown) {
  try {
    // @ts-expect-error systemLog model is added in the Prisma schema (Step 2)
    await prisma.systemLog?.create({
      data: {
        level,
        source: 'api',
        message: message.slice(0, 1000),
        context: context ? JSON.parse(JSON.stringify(context)) : undefined,
      },
    });
  } catch (logErr) {
    logger.warn('Failed to persist SystemLog entry', { logErr });
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = (req.headers['x-request-id'] as string) || undefined;

  // ── Zod validation errors ────────────────────────────────
  if (err instanceof ZodError) {
    res.status(422).json({
      error: 'Validation Error',
      code: 'VALIDATION_FAILED',
      details: err.flatten(),
      requestId,
    });
    return;
  }

  // ── Prisma known request errors ──────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: 'Conflict',
        code: 'UNIQUE_CONSTRAINT',
        message: 'A record with these unique fields already exists.',
        target: (err.meta?.target as string[]) ?? undefined,
        requestId,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Not Found', code: 'RECORD_NOT_FOUND', requestId });
      return;
    }
    logger.error('Prisma known request error', { code: err.code, message: err.message });
    void persistSystemLog('error', `Prisma ${err.code}: ${err.message}`, { requestId });
    res.status(400).json({ error: 'Database Error', code: err.code, requestId });
    return;
  }

  // ── Application errors ────────────────────────────────────
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { stack: err.stack });
      void persistSystemLog('error', err.message, { requestId, stack: err.stack });
    }
    res.status(err.statusCode).json({ error: err.message, code: err.code, requestId });
    return;
  }

  // ── Unknown / unhandled errors ───────────────────────────
  const message = err instanceof Error ? err.message : 'Unknown error';
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('Unhandled error', { message, stack });
  void persistSystemLog('error', message, { requestId, stack });

  res.status(500).json({
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production' ? undefined : message,
    requestId,
  });
};

export default errorHandler;
