import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — SSD Studio',
};

/**
 * =============================================================================
 *  PLACEHOLDER LEGAL CONTENT — ACTION REQUIRED BY THE BUSINESS OWNER
 * =============================================================================
 *  The text below is GENERIC BOILERPLATE for layout/scaffolding purposes only.
 *  It is NOT legal advice and is NOT legally binding.
 *
 *  Before going live you MUST replace this content with your own Terms of
 *  Service, reviewed by a qualified attorney in your jurisdiction. Pay special
 *  attention to: cancellation/refund policy, deposit handling, image/media
 *  usage and licensing rights, liability limitations, and dispute resolution.
 * =============================================================================
 */
export default function TermsPage() {
  return (
    <article className="prose prose-invert mx-auto max-w-2xl">
      <h1>Terms of Service</h1>
      <p className="text-sm text-neutral-500">
        Last updated: [INSERT DATE]. This is placeholder text — replace before launch.
      </p>

      <h2>1. Agreement to Terms</h2>
      <p>
        By booking a session with SSD Studio (&quot;the Studio&quot;), you agree
        to these Terms of Service. [Replace this section with your own binding terms.]
      </p>

      <h2>2. Bookings &amp; Deposits</h2>
      <p>
        A deposit may be required to reserve a session. [Describe your deposit,
        payment, and confirmation policy here.]
      </p>

      <h2>3. Cancellations &amp; Rescheduling</h2>
      <p>
        [State your cancellation window, refund eligibility, and rescheduling
        rules here.]
      </p>

      <h2>4. Media Usage &amp; Licensing</h2>
      <p>
        [Describe how delivered media may be used by the client and any rights
        the Studio retains, including portfolio/marketing usage.]
      </p>

      <h2>5. Limitation of Liability</h2>
      <p>[Insert your liability limitations and disclaimers.]</p>

      <h2>6. Contact</h2>
      <p>Questions about these terms? Contact [INSERT BUSINESS CONTACT EMAIL].</p>
    </article>
  );
}
