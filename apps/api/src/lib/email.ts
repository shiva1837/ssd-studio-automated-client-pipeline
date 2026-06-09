/**
 * SSD Studio — Transactional Email (Resend)
 * Fire-and-forget senders for booking lifecycle notifications.
 */

import { Resend } from 'resend';
import { logger } from './logger';

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const EMAIL_FROM = process.env.EMAIL_FROM || 'SSD Studio <noreply@ssdstudio.com>';
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO;

interface BookingEmailData {
  id: string;
  serviceType: string;
  startTime: Date;
  endTime: Date;
  status: string;
}

function formatSlot(booking: BookingEmailData): string {
  const start = booking.startTime.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const end = booking.endTime.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${start} – ${end}`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    logger.warn(`RESEND_API_KEY not configured — skipping email "${subject}" to ${to}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      ...(EMAIL_REPLY_TO ? { replyTo: EMAIL_REPLY_TO } : {}),
    });
    if (error) {
      logger.error(`Resend rejected email "${subject}" to ${to}: ${error.message}`);
      return;
    }
    logger.info(`Email sent: "${subject}" to ${to}`);
  } catch (err) {
    logger.error(`Failed to send email "${subject}" to ${to}:`, err);
  }
}

export function sendBookingCreatedEmail(
  recipient: { email: string; name: string },
  booking: BookingEmailData
): void {
  const html = `
    <h2>Booking Received</h2>
    <p>Hi ${recipient.name},</p>
    <p>We received your booking request and reserved your slot:</p>
    <ul>
      <li><strong>Service:</strong> ${booking.serviceType}</li>
      <li><strong>When:</strong> ${formatSlot(booking)}</li>
      <li><strong>Status:</strong> ${booking.status}</li>
      <li><strong>Reference:</strong> ${booking.id}</li>
    </ul>
    <p>Your booking is confirmed once payment completes. We will email you right after.</p>
    <p>— SSD Studio</p>
  `;
  void sendEmail(recipient.email, 'SSD Studio — Booking Received', html);
}

export function sendBookingStatusEmail(
  recipient: { email: string; name: string },
  booking: BookingEmailData
): void {
  const subjectByStatus: Record<string, string> = {
    CONFIRMED: 'SSD Studio — Booking Confirmed',
    COMPLETED: 'SSD Studio — Session Complete',
    CANCELLED: 'SSD Studio — Booking Cancelled',
  };
  const subject = subjectByStatus[booking.status] || `SSD Studio — Booking ${booking.status}`;
  const html = `
    <h2>Booking ${booking.status}</h2>
    <p>Hi ${recipient.name},</p>
    <p>Your booking status changed to <strong>${booking.status}</strong>:</p>
    <ul>
      <li><strong>Service:</strong> ${booking.serviceType}</li>
      <li><strong>When:</strong> ${formatSlot(booking)}</li>
      <li><strong>Reference:</strong> ${booking.id}</li>
    </ul>
    <p>— SSD Studio</p>
  `;
  void sendEmail(recipient.email, subject, html);
}
