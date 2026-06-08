# OPENCLAW_ONBOARDING.md

> **Audience:** This document is the operating protocol for the autonomous agent
> (OpenClaw / Hermes) that installs and configures the SSD Studio Automated
> Client Pipeline on behalf of a non-technical studio owner. It is written as an
> interactive wizard: the agent reads each step, prompts the owner, waits for a
> response, and acts. Every integration is **skippable** — the system must come
> up and function (in a degraded but safe mode) even when optional channels are
> not configured.

---

## 0. Operating principles

- **One question at a time.** Never dump the whole questionnaire at once.
- **Confirm before writing.** Echo back what the owner provided before saving it
  to `.env`.
- **Skip gracefully.** If the owner types `skip`, record the integration as
  disabled and disable the dependent workflow nodes rather than failing.
- **Never invent secrets.** Only the owner pastes real keys. The agent writes
  them to `.env` and never echoes them back in full (mask all but the last 4
  characters in any confirmation).
- **Idempotent.** Re-running onboarding must not duplicate config or bookings.

---

## 1. Prerequisite check

Before anything else, verify the host environment:

1. Confirm Docker is installed and the daemon is running:
   ```bash
   docker --version && docker compose version && docker info
   ```
   - If Docker is missing or the daemon is down -> **STOP.** Tell the owner:
     "Docker Desktop must be installed and running before I can continue."
     Provide the install link for their OS and wait. Do not proceed.
2. Confirm there is a writable copy of this repository and that ports
   `3000, 4000, 5432, 5678, 8080` are free. If a port is taken, offer to remap
   it via the `*_PORT` variables in `.env`.
3. Copy the env template if not already present:
   ```bash
   [ -f .env ] || cp .env.example .env
   ```

---

## 2. Core configuration (required)

These are mandatory; the system cannot run without them.

1. **Database password** — generate a strong value, or accept the owner's, and
   write `POSTGRES_PASSWORD` + sync it into `DATABASE_URL`.
2. **JWT secret** — generate a long random string into `JWT_SECRET`.
3. **Internal webhook secret** — generate `WEBHOOK_INTERNAL_SECRET`.
4. **App URLs** — confirm `APP_BASE_URL` and `NEXT_PUBLIC_API_BASE_URL` (default
   to localhost for a local install; ask for the public domain if deploying).

> After this step the owner has a working booking site + API even if every
> optional integration below is skipped.

---

## 3. Integration prompts (each skippable)

For each integration: ask -> on `skip`, set the channel `*_ENABLED=false` flag in
`.env` and note which workflow nodes to leave inactive -> otherwise collect and
store the credentials.

### 3.1 Payments — Stripe (recommended)
- Prompt: "Paste your Stripe **Secret Key** and **Webhook Signing Secret**."
- Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- **If skipped:** bookings are created in `PENDING` and must be confirmed
  manually; the deposit step is bypassed. Warn the owner explicitly.

### 3.2 Email — Resend (recommended)
- Prompt: "Paste your Resend **API key** and the **from address**."
- Store `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- **If skipped:** all email nodes (confirmation, day-of, review) are disabled.
  T-24h reminders will only fire if SMS is configured.

### 3.3 SMS + WhatsApp — Twilio (optional)
- Prompt: "Paste your Twilio **Account SID**, **Auth Token**, the **SMS from**
  number, and the **WhatsApp from** number."
- Store `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`,
  `TWILIO_WHATSAPP_FROM`.
- **If skipped:** the **T-1h SMS-only** reminder cannot be sent. Because policy
  forbids substituting email at T-1h, that node stays inactive. The T-24h step
  falls back to email when a number is absent.

### 3.4 Calendar — Google Calendar (optional)
- Prompt: "Paste the **admin calendar ID**, then authorize the Google
  credential inside n8n when prompted."
- Store `GOOGLE_ADMIN_CALENDAR_ID`; the OAuth/service-account credential is
  attached in the n8n credential store, not in `.env`.
- **If skipped:** calendar events and the `.ics` attachment are omitted from the
  confirmation; everything else proceeds.

### 3.5 Media storage — AWS S3 (optional but needed for delivery)
- Prompt: "Paste your **AWS region**, **access key**, **secret key**, and
  **bucket name**."
- Store `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`.
- **If skipped:** the media-delivery workflow is disabled (no presigned links).

### 3.6 Admin alerting — Telegram + WhatsApp (optional)
- Prompt: "Where should failure alerts go? Paste a **Telegram bot token + chat
  ID** and/or an **admin WhatsApp number**."
- Store `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_WHATSAPP_TO`.
- **If skipped:** the monitor daemon still logs failures to the database but
  cannot push alerts. Strongly recommend configuring at least one channel.

### 3.7 Agent control plane — HITL secret (required for agent ops)
- Generate `HITL_HMAC_SECRET`. This gates the human-in-the-loop tools
  (`reschedule_shoot`, `execute_cancellation`) exposed by the FastMCP server.

---

## 4. Data source routing

Ask the owner where bookings originate and route accordingly:

- "Only this booking site?" -> nothing extra to do.
- "Also an existing form / calendar / spreadsheet?" -> configure the matching
  inbound n8n webhook or poll node, mapping their fields to the API's
  `POST /api/bookings` contract (`clientName`, `clientEmail`, `clientPhone`,
  `startTime`, `packageType`).

---

## 5. Brand styling

Collect light branding and apply it to the frontend:

- Studio display name -> used in the header and email "from" name.
- Primary accent color -> set the Tailwind accent (the booking CTA / selected
  slot color) in `apps/web/tailwind.config.ts`.
- Logo URL (optional) -> drop into the header.
- Review link -> `REVIEW_URL` (used by the FINAL-only review email).

---

## 6. Customization prompt

Ask the open-ended question:

> "Is there anything specific about how you run your studio that I should adapt —
> session lengths, buffer time between shoots, business hours, deposit amount, or
> cancellation policy?"

Translate answers into concrete config: business-hours/slot-generation settings,
package definitions on the booking page, deposit amount in the Stripe step, and
the placeholder cancellation text in `/terms` (flagging that the owner must still
have the legal copy reviewed).

---

## 7. Bring the stack up

```bash
docker compose up -d --build
docker compose ps          # confirm all services are healthy
```

Then import and activate the workflows in `apps/orchestration/workflows` inside
n8n, attaching the credentials gathered above. Disable any nodes whose
integration was skipped in step 3.

---

## 8. Interactive testing

Walk the owner through a guided smoke test and report pass/fail for each:

1. **Health checks** — `GET /api/4000/health`, `GET :8080/health`, n8n UI loads.
2. **Availability** — open the booking page, confirm open slots render.
3. **Reservation race** — create a booking; immediately confirm the same slot is
   no longer offered (validates the DB-level locking).
4. **Payment** — complete a Stripe **test-mode** checkout; confirm the booking
   flips to `CONFIRMED` and the confirmation email/calendar invite fires (only
   for the channels that were configured).
5. **Reminders** — temporarily shorten the wait intervals (or trigger manually)
   to verify: T-24h routes to SMS-if-phone-else-email; day-of email; **T-1h SMS
   only**.
6. **Media delivery** — drop a test FINAL asset; confirm the 72h link email and,
   24h later (or via manual trigger), the single review email. Confirm a RAW
   asset does **not** trigger a review request.
7. **Resilience** — force a node failure; confirm the monitor retries with
   backoff and that an alert reaches the configured Telegram/WhatsApp channel.

Restore the real wait intervals after testing.

---

## 9. Error handling for skipped integrations

Maintain a running summary and present it at the end:

- List every integration marked `skip` and the exact capability that is therefore
  inactive (e.g. "Twilio skipped -> no T-1h SMS reminder; T-24h uses email").
- Confirm no workflow is left in a half-configured state that would throw at
  runtime — every node referencing a skipped credential must be deactivated.
- Remind the owner that `/terms` and `/privacy` contain **placeholder legal text**
  that must be replaced with their own attorney-reviewed copy before launch.
- Provide the re-run instruction: onboarding is idempotent and can be repeated to
  add a skipped integration later.

---

**End of protocol.** Once all required steps pass and the owner has acknowledged
the skipped-integration summary, the pipeline is live and self-operating.
