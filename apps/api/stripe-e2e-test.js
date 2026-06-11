/**
 * One-shot Stripe end-to-end test (run from apps/api):
 * 1. Creates and confirms a REAL test-mode PaymentIntent (test Visa card)
 *    carrying metadata.bookingId — proves the account keys work.
 * 2. Wraps the resulting PaymentIntent in a webhook event envelope, signs it
 *    with STRIPE_WEBHOOK_SECRET (exactly how Stripe signs deliveries), and
 *    POSTs it to the local webhook endpoint — proves signature verification
 *    and the booking CONFIRMED transition.
 */
require('dotenv/config');
const Stripe = require('stripe');

const bookingId = process.argv[2];
const amountCents = Number(process.argv[3] || 35000);
if (!bookingId) {
  console.error('usage: node stripe-e2e-test.js <bookingId> [amountCents]');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const whsec = process.env.STRIPE_WEBHOOK_SECRET;

(async () => {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    payment_method: 'pm_card_visa',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: { bookingId },
  });
  console.log(`PAYMENT_INTENT ${pi.id} status=${pi.status} amount_received=${pi.amount_received}`);

  const event = {
    id: 'evt_local_e2e_test',
    object: 'event',
    api_version: pi.api_version || '2025-01-27',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'payment_intent.succeeded',
    data: { object: pi },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: whsec });

  const res = await fetch('http://localhost:4000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  console.log(`WEBHOOK_RESPONSE ${res.status} ${await res.text()}`);

  // Negative control: a tampered payload must be rejected
  const badRes = await fetch('http://localhost:4000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload.replace(amountCents.toString(), '999999'),
  });
  console.log(`TAMPERED_RESPONSE ${badRes.status} (expect 400)`);
})().catch((err) => { console.error('E2E_FAIL', err.message); process.exit(1); });
