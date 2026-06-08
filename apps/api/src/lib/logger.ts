/**
 * SSD Studio — Structured Logger (Winston)
 * Central logging utility with leveled output and JSON formatting in production.
 * Exposes .error / .warn / .info / .http / .debug used across the API.
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const isProduction = process.env.NODE_ENV === 'production';

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}] ${stack || message}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  levels,
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'ssd-studio-api' },
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

export default logger;
