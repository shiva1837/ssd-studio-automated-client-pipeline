/**
 * SSD Studio — n8n Webhook Dispatcher (Resilience Layer)
 * Fires events into n8n workflows with exponential-backoff retries.
 * On exhausted retries it logs to SystemLogs and notifies the admin
 * alert channel (Telegram/WhatsApp) — no autonomous code mutation.
 */

import { logger } from './logger';
import { prisma } from './prisma';
import { sendAdminAlert } from './alerts';

const MAX_RETRIES = Number(process.env.N8N_MAX_RETRIES || 4);
const BASE_DELAY_MS = Number(process.env.N8N_BASE_DELAY_MS || 500);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST an event payload to an n8n webhook path with retry + backoff.
 * Returns true on success, false if all attempts fail (non-throwing).
 */
export async function triggerN8nWebhook(
  path: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const base = process.env.N8N_WEBHOOK_URL;
  if (!base) {
    logger.warn(`N8N_WEBHOOK_URL unset; skipping webhook '${path}'`);
    return false;
  }

  const url = `${base.replace(/\/$/, '')}/${path}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.WEBHOOK_INTERNAL_SECRET || '',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        logger.info(`n8n webhook '${path}' delivered (attempt ${attempt})`);
        return true;
      }
      lastError = new Error(`n8n responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < MAX_RETRIES) {
      // exponential backoff with jitter
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      logger.warn(`n8n webhook '${path}' attempt ${attempt} failed; retrying in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }

  const message = `n8n webhook '${path}' failed after ${MAX_RETRIES} attempts: ${String(
    lastError instanceof Error ? lastError.message : lastError
  )}`;
  logger.error(message);

  // Persist + alert (best-effort, never throws)
  try {
    // @ts-expect-error systemLog model added in Step 2
    await prisma.systemLog?.create({
      data: { level: 'error', source: 'n8n-dispatch', message, context: { path, payload } },
    });
  } catch {
    /* swallow */
  }
  await sendAdminAlert(`⚠️ n8n webhook '${path}' failed after ${MAX_RETRIES} retries.`);

  return false;
}

export default triggerN8nWebhook;
