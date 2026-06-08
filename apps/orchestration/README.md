# SSD Studio — Orchestration (n8n Workflows)

This directory holds the n8n workflow definitions that drive the studio's
notification lifecycle. Import them via the n8n UI (Workflows → Import from File)
or load on startup with the n8n CLI.

## Workflows

### `workflows/booking-lifecycle.json`
Triggered by the API on booking finalization (`POST {N8N_WEBHOOK_URL}/booking-created`).

| Stage | Trigger | Channel | Notes |
|-------|---------|---------|-------|
| Confirmation (t+0) | immediately | Email (Resend) | Includes Google Calendar link + .ics + "next steps" |
| Calendar | immediately | Google Calendar API | Event created on the admin calendar |
| T-24h | `Wait` until startTime − 24h | **SMS if phone present, else Email** | `IF phone present?` branch |
| Day-Of | `Wait` until 08:00 local on event day | Email | Parking / access reminder |
| T-1h | `Wait` until startTime − 1h | **SMS ONLY** (no email) | Strict per spec |

Each stage posts back to `POST {API_BASE_URL}/api/webhooks/n8n` with a `stage`
value (`CONFIRMATION`, `REMINDER_24H`, `DAY_OF`, `REMINDER_1H`) so the API can
stamp the matching `reminderSent*At` column on the booking.

### `workflows/media-delivery.json`
Triggered by the API after an S3 upload generates a presigned URL
(`POST {N8N_WEBHOOK_URL}/media-ready`).

| Branch | Link TTL | Follow-up |
|--------|----------|-----------|
| `assetType = FINAL` | 72h | Review request 24h later |
| `assetType = UNEDITED` (RAW) | 12h | — |

> **Refinement note:** both branches currently converge on the shared
> `MEDIA_DELIVERED` ack before the 24h follow-up. If you want the review
> request to fire on FINAL deliveries only, split the ack so the RAW branch
> ends after its delivery email. Left as a one-line connection change so the
> studio can decide their preferred behavior.

## Required environment variables
These are read by the workflows via `{{ $env.* }}`:

- `API_BASE_URL` — base URL of the Express API (e.g. http://api:4000)
- `WEBHOOK_INTERNAL_SECRET` — shared secret for internal API callbacks
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `TWILIO_ACCOUNT_SID`, `TWILIO_SMS_FROM` (+ HTTP Basic Auth credential in n8n)
- `GOOGLE_ADMIN_CALENDAR_ID` (+ Google Calendar OAuth2 credential in n8n)
- `REVIEW_URL` — link used in the follow-up email

## Credentials to configure in n8n
- **Google Calendar OAuth2** (`googleCalendarOAuth2Api`)
- **HTTP Basic Auth** for Twilio (username = Account SID, password = Auth Token)

Resend and the internal API calls authenticate via headers and need no n8n credential.
