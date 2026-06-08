/**
 * SSD Studio — Admin Alerting
 * Dispatches operational alerts to the admin via Telegram and/or
 * Twilio WhatsApp. Used by the resilience layer when retries are
 * exhausted. All sends are best-effort and never throw.
 */

import { logger } from './logger';

async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (err) {
    logger.warn('Telegram alert failed', { err: (err as Error).message });
  }
}

async function sendWhatsApp(message: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+14155238886'
  const to = process.env.ADMIN_WHATSAPP_TO;      // e.g. 'whatsapp:+1...'
  if (!sid || !authToken || !from || !to) return;

  try {
    const body = new URLSearchParams({ From: from, To: to, Body: message });
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
  } catch (err) {
    logger.warn('WhatsApp alert failed', { err: (err as Error).message });
  }
}

/**
 * Fan-out an alert to all configured admin channels.
 */
export async function sendAdminAlert(message: string): Promise<void> {
  logger.warn(`ADMIN ALERT: ${message}`);
  await Promise.allSettled([sendTelegram(message), sendWhatsApp(message)]);
}

export default sendAdminAlert;
