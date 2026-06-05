# SSD Studio — Automated Client Pipeline

> **Enterprise-grade, zero-touch autonomous creative studio booking and delivery system.**  
> A 5-minute self-serve booking flow, instant financial confirmations, cron-based logistical reminders, automated post-shoot follow-ups, and secure media delivery via dynamically generated presigned S3 URLs.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Turborepo](https://img.shields.io/badge/Monorepo-Turborepo-EF4444.svg)](https://turbo.build)

---

## Architectural Philosophy

SSD Studio's pipeline is built on a single, non-negotiable principle: **code only matters when it serves a real business outcome.** Every architectural decision traces back to a measurable client experience improvement.

The system rejects the conventional approach of bolting automation onto an existing booking workflow. Instead, it is designed **automation-first**: the entire client lifecycle — from the moment a lead discovers the studio to the moment they receive their final edited package — is a fully deterministic, zero-touch sequence of events orchestrated by interconnected services. No manual intervention. No dropped emails. No missed follow-ups.

Three architectural pillars underpin this philosophy:

**1. Deterministic Lifecycle Execution.** The 7-stage pipeline (below) is not a set of suggestions — it is a contract. Every client who books a session will receive the exact same communications, at the exact same intervals, with mathematically guaranteed delivery windows. This is enforced through n8n's durable workflow execution with persistent state, not fire-and-forget cron jobs.

**2. Defense-in-Depth for Data Integrity.** The slot reservation system employs two independent layers of conflict prevention: a Redis distributed lock (atomic NX operation, prevents concurrent reservation races at the application layer) combined with a PostgreSQL serializable transaction (prevents conflicts at the database layer). This dual-guard makes double-bookings mathematically impossible even under high concurrency.

**3. Trust-Minimized Agentic Operations.** The CereFlow AI agent layer does not execute irreversible operations autonomously. Every destructive action (cancellation, refund trigger, data mutation) is gated behind a cryptographic HITL (Human-in-the-Loop) challenge-response protocol using HMAC-SHA256. The agent generates a time-bound challenge token; a human operator must provide the signed authorization before execution proceeds. This prevents prompt injection attacks from triggering irreversible business logic.

---

## The 7-Stage Deterministic Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SSD STUDIO CLIENT LIFECYCLE                              │
├──────┬──────────────────────────────────────────────────────────────────────┤
│ ①   │  CLIENT DISCOVERY                                                     │
│      │  React Three Fiber 3D hero → Service Grid → Booking Wizard           │
│      │  Target: Sub-5-minute self-serve reservation                         │
├──────┼──────────────────────────────────────────────────────────────────────┤
│ ②   │  SLOT RESERVATION & PAYMENT                                           │
│      │  Redis lock + Postgres serializable TX → Stripe payment intent       │
│      │  n8n webhook trigger on payment_intent.succeeded                     │
├──────┼──────────────────────────────────────────────────────────────────────┤
│ ③   │  INSTANT CONFIRMATION (t+0)                                           │
│      │  Resend API dispatches React Email confirmation template             │
│      │  API audit: confirmationSentAt timestamp recorded                    │
├──────┼──────────────────────────────────────────────────────────────────────┤
│ ④   │  48-HOUR PREPARATION GUIDE (t-48h)                                   │
│      │  n8n Wait node → Resend preparation guide email                     │
│      │  Includes: what to wear, location details, shot list template        │
├──────┼──────────────────────────────────────────────────────────────────────┤
│ ⑤   │  24-HOUR FINAL TIMELINE (t-24h)                                      │
│      │  n8n Wait node → Resend final confirmation with exact timeline       │
│      │  Day-of reminder at t-2h with parking/access instructions            │
├──────┼──────────────────────────────────────────────────────────────────────┤
│ ⑥   │  UNEDITED DELIVERY (within 12h of shoot)                             │
│      │  S3 upload event → API webhook → presigned URL generation (12h TTL) │
│      │  n8n media-delivery workflow dispatches download link via Resend     │
├──────┼──────────────────────────────────────────────────────────────────────┤
│ ⑦   │  FINAL EDITED DELIVERY + FOLLOW-UP (within 48-72h)                  │
│      │  S3 FINAL upload event → 72h presigned URL → Resend delivery email  │
│      │  n8n dispatches post-shoot follow-up + review request 24h later     │
└──────┴──────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Agent Cognitive Core

### CereFlow — FastMCP Agentic Layer

The `apps/agents` module implements **CereFlow**, a Python-based AI agent server using [FastMCP](https://github.com/jlowin/fastmcp) with SSE (Server-Sent Events) transport. CereFlow exposes a suite of `@mcp.tool()` functions that LLM clients can call to autonomously manage the booking lifecycle.

**Exposed MCP Tools:**

| Tool | Description |
|------|-------------|
| `list_bookings` | Query PostgreSQL booking records with status filter and pagination |
| `get_booking` | Retrieve full booking details including media asset status |
| `request_reschedule_challenge` | Generate HITL challenge token for rescheduling |
| `reschedule_shoot` | Execute reschedule after HITL validation |
| `request_cancellation_challenge` | Generate HITL challenge token for cancellation |
| `execute_cancellation` | Execute cancellation after HITL validation |
| `get_booking_analytics` | Retrieve revenue and conversion analytics |

### HITL Cryptographic Safeguards

All irreversible operations are protected by a two-step HMAC-SHA256 challenge-response protocol:

```
Agent                          Human Operator                    System
  │                                 │                              │
  │── request_*_challenge ─────────►│                              │
  │◄─ { challenge_token } ──────────│                              │
  │                                 │                              │
  │   [Human verifies intent]       │                              │
  │                                 │                              │
  │── execute_* (challenge_token) ──┼──────────────────────────────►│
  │                                 │   [HMAC validated + executed] │
  │◄──────────────────────────────── { success: true } ────────────│
```

Challenge tokens are:
- **Time-bound**: expire after `HITL_TOKEN_EXPIRY_SECONDS` (default: 300s)
- **Operation-scoped**: tied to a specific operation type and entity ID
- **Replay-resistant**: each token is unique and single-use
- **Constant-time verified**: `hmac.compare_digest` prevents timing attacks

---

## Technical Stack Matrix

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Monorepo** | Turborepo | 2.x | Parallel builds, shared packages, task pipelines |
| **Frontend** | Next.js | 16 | App Router, RSC, streaming, metadata API |
| **UI Runtime** | React | 19 | Concurrent features, server components |
| **Styling** | Tailwind CSS | 3.4 | Utility-first, responsive design system |
| **3D Rendering** | React Three Fiber + Drei | 8.x / 9.x | Immersive WebGL hero section |
| **State Management** | RTK Query | 2.x | Real-time slot availability, cache invalidation |
| **Backend** | Node.js / Express | 20+ / 4.x | RESTful API, webhook listeners |
| **ORM** | Prisma | 5.x | Type-safe PostgreSQL client, migrations |
| **Database** | PostgreSQL | 16 | Primary relational store |
| **Distributed Lock** | Redis (ioredis) | 7 | Atomic slot locking, session cache |
| **Orchestration** | n8n | Latest | Visual workflow automation, durable execution |
| **Email** | Resend API | Latest | Transactional email with React templates |
| **Storage** | Amazon S3 SDK | 3.x | Media asset storage, presigned URL generation |
| **Payments** | Stripe | 2024-04-10 | Payment processing, webhook verification |
| **Agent Runtime** | Python | 3.11+ | CereFlow MCP server |
| **MCP Framework** | FastMCP | 2.x | SSE transport, tool registration |
| **Agent DB Driver** | asyncpg | 0.29+ | Async PostgreSQL for agent queries |
| **WebRTC** | LiveKit | 0.11+ | Real-time agent communication |
| **Containerization** | Docker Compose | 3.9 | Local dev orchestration |
| **Auth** | JWT (jsonwebtoken) | 9.x | Stateless token-based auth |

---

## Monorepo Structure

```
ssd-studio-automated-client-pipeline/
├── apps/
│   ├── web/                         # Next.js 16 frontend
│   │   └── src/
│   │       ├── app/                 # App Router pages & layouts
│   │       ├── components/          # React components (booking wizard, 3D canvas)
│   │       └── store/               # RTK Query API slices
│   ├── api/                         # Node.js / Express backend
│   │   └── src/
│   │       ├── index.ts             # Server entry point
│   │       ├── middleware/          # JWT auth, error handling, rate limiting
│   │       └── routes/              # bookings, auth, webhooks, media
│   ├── orchestration/               # n8n workflow JSON schemas
│   │   └── workflows/
│   │       ├── booking-lifecycle.json   # Confirmation + reminder chain
│   │       └── media-delivery.json      # S3 → presigned URL → email chain
│   └── agents/                      # Python FastMCP agent server
│       ├── server.py                # CereFlow MCP tools + HITL safeguards
│       ├── requirements.txt         # Python dependencies
│       └── Dockerfile               # Container definition
├── packages/
│   ├── db/                          # Shared Prisma schema
│   │   └── prisma/
│   │       └── schema.prisma        # User, Booking, MediaAsset, AuditLog models
│   └── ui/                          # Shared Shadcn component library
├── docker-compose.yml               # Postgres + n8n + FastMCP orchestration
├── .env.example                     # Environment variable template
├── turbo.json                       # Turborepo pipeline configuration
├── package.json                     # Root workspace configuration
└── README.md
```

---

## Deployment & Installation Protocol

### Prerequisites

- Node.js ≥ 20.0.0
- Python ≥ 3.11
- Docker & Docker Compose
- npm ≥ 10.0.0

### Step 1 — Clone the Repository

```bash
git clone https://github.com/shiva1837/ssd-studio-automated-client-pipeline.git
cd ssd-studio-automated-client-pipeline
```

### Step 2 — Install Node.js Dependencies

```bash
npm install
```

This installs all workspace dependencies across `apps/web`, `apps/api`, `packages/db`, and `packages/ui`.

### Step 3 — Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in all required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Min 32-char random string |
| `RESEND_API_KEY` | ✅ | From [resend.com](https://resend.com) |
| `AWS_ACCESS_KEY_ID` | ✅ | IAM user with S3 read/write |
| `AWS_SECRET_ACCESS_KEY` | ✅ | Corresponding secret |
| `STRIPE_SECRET_KEY` | ✅ | From Stripe dashboard |
| `HITL_HMAC_SECRET` | ✅ | Min 32-char secret for HITL |
| `N8N_ENCRYPTION_KEY` | ✅ | Min 32-char n8n encryption key |

### Step 4 — Launch Infrastructure (Docker)

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379
- **n8n** on port 5678 (UI: http://localhost:5678)
- **FastMCP Agent** on port 8080

### Step 5 — Push Database Schema

```bash
npx prisma db push --schema=packages/db/prisma/schema.prisma
```

Or use the workspace script:

```bash
npm run db:push
```

### Step 6 — Generate Prisma Client

```bash
npm run db:generate
```

### Step 7 — Start Development Servers

```bash
npm run dev
```

Turborepo starts all apps in parallel:
- **Frontend**: http://localhost:3000
- **API**: http://localhost:4000
- **Health check**: http://localhost:4000/health

### Step 8 — Import n8n Workflows

1. Navigate to http://localhost:5678
2. Log in with `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD`
3. Go to **Workflows → Import**
4. Import `apps/orchestration/workflows/booking-lifecycle.json`
5. Import `apps/orchestration/workflows/media-delivery.json`
6. Configure credentials (Resend API key, internal API URL)
7. Activate both workflows

---

## Environment Security Notes

- **Never commit `.env`** — it is gitignored by default
- Rotate `JWT_SECRET` and `HITL_HMAC_SECRET` regularly in production
- Use AWS IAM roles with least-privilege S3 access
- Set `N8N_BASIC_AUTH_ACTIVE=true` in all environments
- The `MCP_SECRET_KEY` validates internal webhook calls from API → n8n → agents

---

## License

MIT © SSD Studio
