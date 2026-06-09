/**
 * SSD Studio — Audit Logging
 * Writes lifecycle events to the audit_logs table.
 * Failures are logged but never break the request that triggered them.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';

export async function writeAuditLog(
  entityType: string,
  entityId: string,
  action: string,
  actorId: string | null,
  metadata?: Prisma.InputJsonValue
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { entityType, entityId, action, actorId, metadata },
    });
  } catch (err) {
    logger.error(`Failed to write audit log (${entityType}/${entityId} ${action}):`, err);
  }
}
