# SSD Studio — Automated Client Pipeline

An enterprise-grade, near-zero-touch booking and delivery system for a creative
studio. A client books a session online, pays a deposit, and is then carried
through a fully automated lifecycle — calendar invite, instant confirmation,
time-staggered reminders, and secure media delivery — orchestrated by n8n and
supervised by a self-healing monitoring daemon. The stack is designed to run
detached, 24/7, and to be installed and operated by an external autonomous
agent (OpenClaw) via an interactive onboarding wizard.

> **Status:** This branch (`feature/autonomous-pipeline-build`) is delivered as
> a reviewable Pull Request. Nothing has been merged to `main`. The build has
> not been compiled/run in CI here — run the local validation steps below on
> first checkout.

---

## Architecture

| Layer | Tech | Path |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind, RTK Query | `apps/web` |
| Backend API | Node.js / Express, JWT auth, Prisma | `apps/api` |
| Database | PostgreSQL + Prisma schema | `packages/db` |
| Orchestration | n8n workflows, Resend, Twilio/WhatsApp, Google Calendar | `apps/orchestration` |
| Agentic layer | Python 3.11, FastMCP (SSE), monitor daemon | `apps/agents` |
| Infrastructure | Docker Compose (detached) | `docker-compose.yml` |

### Concurrency model
There is **no Redis / application-level locking**. Double-bookings are prevented
at the database layer via a `UNIQUE` constraint on the booking slot combined with
`SELECT ... FOR UPDATE` transactions in Prisma.

### Resilience model
There is **no autonomous code-rewriting**. Production resilience is achieved
through structured logging (persisted to the `SystemLog` table), retry with
exponential backoff, circuit breakers, and an alerting webhook that notifies the
admin over Telegram and WhatsApp when a pipeline or node fails. The `monitor`
daemon polls n8n and the logs table, retries failed executions, and escalates.

---

## Notification lifecycle (canonical)

1. **Booking finalized** (Stripe deposit confirmed) -> create Google Calendar
   event + `.ics` -> instant confirmation email with a "Next Steps" section.
2. **T-24h** -> SMS if a mobile number is on file, otherwise email.
3. **Day-of** -> reminder email.
4. **T-1h** -> **SMS only** (strict: never email at the one-hour mark).
5. **Media delivery** -> RAW assets get a 12h link and stop there; FINAL assets
   get a 72h link and, **24h after the FINAL package only**, a single
   review-request email.

---

## Repository layout

```
apps/
  web/            Next.js 16 booking frontend (RTK Query, Tailwind)
  api/            Express API (auth, bookings, Stripe/n8n/S3 webhooks)
  orchestration/  n8n workflow JSON (booking-lifecycle, media-delivery)
  agents/         FastMCP server + self-healing monitor daemon (Python)
packages/
  db/             Prisma schema (User, Booking, MediaAsset, SystemLog)
docker-compose.yml
.env.example
OPENCLAW_ONBOARDING.md
```

---

## Quick start (local)

```bash
# 1. Configure environment
cp .env.example .env
#    -> edit .env and inject your own secrets

# 2. Bring up the full stack, detached
docker compose up -d --build

# 3. Apply the database schema (first run)
#    The API container runs `prisma migrate deploy` on boot. To create the
#    initial migration during development:
docker compose exec api npx prisma migrate dev --schema=/repo/packages/db/prisma/schema.prisma

# 4. Open the apps
#    Web:   http://localhost:3000
#    API:   http://localhost:4000/health
#    n8n:   http://localhost:5678
#    Agent: http://localhost:8080/health
```

Import the workflow JSON in `apps/orchestration/workflows` into n8n (they are
mounted into the container), attach your credentials, and activate them.

---

## Validation checklist (run on first checkout)

Because this environment cannot execute builds, please verify locally:

- [ ] `npm install` at the repo root resolves the workspaces.
- [ ] `npm run build` in `apps/api` (`tsc`) compiles with no errors.
- [ ] `npm run build` in `apps/web` (`next build`) succeeds.
- [ ] `npx prisma validate` against `packages/db/prisma/schema.prisma` passes.
- [ ] `docker compose config` parses the compose file with no errors.
- [ ] Python deps in `apps/agents/requirements.txt` install cleanly.

---

## Agent-operated setup

For the autonomous onboarding flow (prerequisite checks, channel integration
prompts with skip logic, brand styling, interactive testing, and graceful
handling of skipped integrations), see **[OPENCLAW_ONBOARDING.md](./OPENCLAW_ONBOARDING.md)**.

---

## Security notes

- No real secrets are committed. `.env.example` is a template only.
- Stripe webhooks are verified with `express.raw()` signature checking; the
  n8n/S3 internal webhooks use a shared `WEBHOOK_INTERNAL_SECRET` header.
- Human-in-the-loop agent tools (reschedule / cancellation) are gated by an
  HMAC-SHA256 signature (`HITL_HMAC_SECRET`).
- The legal pages (`/terms`, `/privacy`) ship with **placeholder boilerplate**.
  The business owner must replace them with their own legally binding text.
