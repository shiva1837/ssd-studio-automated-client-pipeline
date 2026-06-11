/**
 * SSD Studio — API Server Entry Point
 * Node.js / Express RESTful API
 * Handles booking lifecycle, auth, and webhooks
 */

import 'dotenv/config';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { webhooksRouter } from './routes/webhooks';
import { mediaRouter } from './routes/media';
import { analyticsRouter } from './routes/analytics';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

const app: Application = express();
const PORT = process.env.API_PORT || 4000;
const HOST = process.env.API_HOST || '0.0.0.0';

// Trust proxy (for correct rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])],
    },
  },
}));

// ============================================================
// CORS CONFIGURATION
// ============================================================
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ============================================================
// RATE LIMITING
// ============================================================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// ============================================================
// LOGGING
// ============================================================
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.http(message.trim()),
  },
}));

// ============================================================
// WEBHOOKS — mounted BEFORE the global rate limiter
// ============================================================
// Stripe retries aggressively; rate-limiting its callbacks drops payment
// events. The raw body parser is scoped here because signature verification
// needs the unparsed payload (express.json would consume it).
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

// ============================================================
// RATE LIMITING (webhooks above are exempt)
// ============================================================
app.use('/api/auth', authLimiter);
app.use('/api', globalLimiter);

// ============================================================
// REQUEST PARSING
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'ssd-studio-api',
      version: process.env.npm_package_version || '1.0.0',
      database: 'connected',
    });
  } catch {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/analytics', analyticsRouter);

// ============================================================
// ERROR HANDLING
// ============================================================
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================
// SERVER STARTUP
// ============================================================
const server = app.listen(Number(PORT), HOST, () => {
  logger.info(`SSD Studio API running at http://${HOST}:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Database disconnected. Server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
