/**
 * SSD Studio — JWT Authentication Middleware
 * Validates Bearer tokens for protected API routes
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export interface JWTPayload {
  sub: string;   // User ID
  email: string;
  name: string;
  iat: number;
  exp: number;
}

/**
 * requireAuth — Validates JWT and attaches user to request.
 * Rejects with 401 if token is missing, malformed, or expired.
 */
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
      });
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      logger.error('JWT_SECRET environment variable is not configured');
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

    // Verify user still exists in database (prevents token reuse after deletion)
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User associated with this token no longer exists',
      });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token has expired. Please re-authenticate.',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token signature or format.',
        code: 'TOKEN_INVALID',
      });
      return;
    }

    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * optionalAuth — Attaches user to request if valid token provided.
 * Does not reject if token is absent (for public routes with optional auth context).
 */
export const optionalAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) { next(); return; }

    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, name: true },
    });

    if (user) req.user = user;
    next();
  } catch {
    // Silently fail for optional auth
    next();
  }
};
