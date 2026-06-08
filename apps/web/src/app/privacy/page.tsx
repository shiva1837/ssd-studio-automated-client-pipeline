import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — SSD Studio',
};

/**
 * =============================================================================
 *  PLACEHOLDER LEGAL CONTENT — ACTION REQUIRED BY THE BUSINESS OWNER
 * =============================================================================
 *  The text below is GENERIC BOILERPLATE for layout/scaffolding purposes only.
 *  It is NOT legal advice and is NOT legally binding.
 *
 *  Before going live you MUST replace this with your own Privacy Policy,
 *  reviewed by a qualified attorney. Ensure it accurately reflects the data you
 *  collect (name, email, phone, payment data via Stripe), the third-party
 *  processors you use (Stripe, Resend, Twilio, Google Calendar, AWS S3), your
 *  retention periods, and the rights afforded under applicable law
 *  (e.g. GDPR / CCPA).
 * =============================================================================
 */
export default function PrivacyPage() {
  return (
    <article className="prose prose-invert mx-auto max-w-2xl">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-neutral-500">
        Last updated: [INSERT DATE]. This is placeholder text — replace before launch.
      </p>

      <h2>1. Information We Collect</h2>
      <p>
        We collect the information you provide when booking, such as your name,
        email address, and (optionally) mobile number. [Adjust to match your
        actual data collection.]
      </p>

      <h2>2. How We Use Your Information</h2>
      <p>
        We use your information to confirm bookings, send reminders and delivery
        notifications, process payments, and provide your media. [Describe your
        actual processing purposes.]
      </p>

      <h2>3. Third-Party Processors</h2>
      <p>
        We share data with service providers strictly to deliver our service —
        for example payment processing, email, SMS, calendaring, and media
        storage. [List your actual sub-processors here.]
      </p>

      <h2>4. Data Retention</h2>
      <p>[State how long you retain personal data and delivered media.]</p>

      <h2>5. Your Rights</h2>
      <p>
        [Describe the rights available to your customers — access, correction,
        deletion, etc. — and how to exercise them.]
      </p>

      <h2>6. Contact</h2>
      <p>For privacy requests, contact [INSERT BUSINESS CONTACT EMAIL].</p>
    </article>
  );
}
