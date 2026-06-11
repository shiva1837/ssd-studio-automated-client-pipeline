/**
 * SSD Studio — Audit Log Helper
 * Centralized audit log writing to avoid duplication across routes.
 */

import { prisma } from './prisma';
import { logger } from './logger';

export async function writeAuditLog(
  entityType: string,
  entityId: string,
  action: string,
  actorId: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType,
        entityId,
        action,
        actorId,
        metadata: metadata as any,
      },
    });
  } catch (error) {
    // Audit logging should never break the main operation
    logger.error(`Failed to write audit log (${action} on ${entityType}:${entityId}):`, error);
  }
}
