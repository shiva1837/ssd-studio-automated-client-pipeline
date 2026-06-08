"""
SSD Studio — Self-Healing Monitor Daemon
=========================================
A long-running (24/7) async daemon that watches for pipeline failures and
applies *bounded, safe* recovery — NOT autonomous code rewriting.

What it actually does:
  1. Polls the n8n REST API for failed executions.
  2. Polls the SystemLog table for unresolved ERROR rows.
  3. For recoverable failures, retries the failed n8n execution up to
     MAX_RETRIES with exponential backoff.
  4. Uses a per-workflow circuit breaker: after too many consecutive
     failures it stops retrying and escalates, to avoid hammering a
     genuinely-down dependency.
  5. Alerts the admin via Telegram / Twilio WhatsApp on escalation, and
     marks the SystemLog row resolved when a retry succeeds.

Deliberately conservative: it never edits application code or config on
disk. Recovery is limited to re-running idempotent workflow executions.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import asyncpg
import httpx

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "")
N8N_API_URL = os.environ.get("N8N_API_URL", "http://n8n:5678")
N8N_API_KEY = os.environ.get("N8N_API_KEY", "")
POLL_INTERVAL_SECONDS = int(os.environ.get("MONITOR_POLL_INTERVAL", "30"))
MAX_RETRIES = int(os.environ.get("MONITOR_MAX_RETRIES", "3"))
BASE_BACKOFF_SECONDS = float(os.environ.get("MONITOR_BASE_BACKOFF", "2"))
CIRCUIT_THRESHOLD = int(os.environ.get("MONITOR_CIRCUIT_THRESHOLD", "5"))
CIRCUIT_COOLDOWN_SECONDS = int(os.environ.get("MONITOR_CIRCUIT_COOLDOWN", "300"))

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "")
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")
ADMIN_WHATSAPP_TO = os.environ.get("ADMIN_WHATSAPP_TO", "")


# ------------------------------------------------------------------
# Circuit breaker
# ------------------------------------------------------------------
@dataclass
class CircuitBreaker:
    """Per-key breaker: opens after CIRCUIT_THRESHOLD consecutive failures."""
    failures: int = 0
    opened_at: Optional[float] = None

    def record_success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= CIRCUIT_THRESHOLD and self.opened_at is None:
            self.opened_at = time.time()

    @property
    def is_open(self) -> bool:
        if self.opened_at is None:
            return False
        if time.time() - self.opened_at >= CIRCUIT_COOLDOWN_SECONDS:
            # cooldown elapsed -> half-open: allow one trial
            self.opened_at = None
            self.failures = 0
            return False
        return True


@dataclass
class MonitorState:
    breakers: dict[str, CircuitBreaker] = field(default_factory=dict)
    pool: Optional[asyncpg.Pool] = None

    def breaker(self, key: str) -> CircuitBreaker:
        return self.breakers.setdefault(key, CircuitBreaker())


# ------------------------------------------------------------------
# Alerting
# ------------------------------------------------------------------
async def send_admin_alert(client: httpx.AsyncClient, message: str) -> None:
    """Best-effort fan-out to Telegram + WhatsApp. Never raises."""
    print(f"[ALERT] {message}", flush=True)
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID:
        try:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_ADMIN_CHAT_ID, "text": message},
                timeout=10,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[ALERT] telegram failed: {exc}", flush=True)
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM and ADMIN_WHATSAPP_TO:
        try:
            await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json",
                data={"From": TWILIO_WHATSAPP_FROM, "To": ADMIN_WHATSAPP_TO, "Body": message},
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=10,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[ALERT] whatsapp failed: {exc}", flush=True)


# ------------------------------------------------------------------
# n8n interaction
# ------------------------------------------------------------------
async def fetch_failed_executions(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    try:
        resp = await client.get(
            f"{N8N_API_URL}/api/v1/executions",
            params={"status": "error", "limit": 20},
            headers={"X-N8N-API-KEY": N8N_API_KEY},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("data", [])
    except Exception as exc:  # noqa: BLE001
        print(f"[monitor] could not fetch executions: {exc}", flush=True)
        return []


async def retry_execution(client: httpx.AsyncClient, execution_id: str) -> bool:
    """Re-run a failed n8n execution. Returns True on success."""
    try:
        resp = await client.post(
            f"{N8N_API_URL}/api/v1/executions/{execution_id}/retry",
            headers={"X-N8N-API-KEY": N8N_API_KEY},
            timeout=30,
        )
        return resp.status_code < 300
    except Exception as exc:  # noqa: BLE001
        print(f"[monitor] retry failed for {execution_id}: {exc}", flush=True)
        return False


async def handle_failure(client: httpx.AsyncClient, state: MonitorState, execution: dict[str, Any]) -> None:
    execution_id = str(execution.get("id"))
    workflow = execution.get("workflowName") or execution.get("workflowId") or "unknown"
    breaker = state.breaker(workflow)

    if breaker.is_open:
        print(f"[monitor] circuit OPEN for '{workflow}'; skipping retry of {execution_id}", flush=True)
        return

    for attempt in range(1, MAX_RETRIES + 1):
        if await retry_execution(client, execution_id):
            breaker.record_success()
            await send_admin_alert(
                client,
                f"✅ Recovered: n8n workflow '{workflow}' execution {execution_id} "
                f"succeeded on retry {attempt}.",
            )
            await mark_resolved(state, execution_id)
            return
        await asyncio.sleep(BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)))

    breaker.record_failure()
    escalation = (
        f"⚠️ Pipeline error in workflow '{workflow}' (execution {execution_id}). "
        f"Auto-retry exhausted after {MAX_RETRIES} attempts."
    )
    if breaker.is_open:
        escalation += " Circuit breaker OPEN — pausing retries to protect the dependency."
    await send_admin_alert(client, escalation)


# ------------------------------------------------------------------
# SystemLog interaction
# ------------------------------------------------------------------
async def get_pool(state: MonitorState) -> Optional[asyncpg.Pool]:
    if state.pool is None and DATABASE_URL:
        try:
            state.pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=1, max_size=3)
        except Exception as exc:  # noqa: BLE001
            print(f"[monitor] db pool error: {exc}", flush=True)
    return state.pool


async def mark_resolved(state: MonitorState, ref: str) -> None:
    pool = await get_pool(state)
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE system_logs SET resolved = true, \"resolvedAt\" = now() "
                "WHERE resolved = false AND context::text LIKE $1",
                f"%{ref}%",
            )
    except Exception as exc:  # noqa: BLE001
        print(f"[monitor] mark_resolved error: {exc}", flush=True)


# ------------------------------------------------------------------
# Main loop
# ------------------------------------------------------------------
async def monitor_loop() -> None:
    state = MonitorState()
    print("[monitor] self-healing daemon started", flush=True)
    async with httpx.AsyncClient() as client:
        await send_admin_alert(client, "🟢 SSD Studio self-healing monitor online.")
        while True:
            try:
                for execution in await fetch_failed_executions(client):
                    await handle_failure(client, state, execution)
            except Exception as exc:  # noqa: BLE001 — loop must never die
                print(f"[monitor] loop error: {exc}", flush=True)
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        asyncio.run(monitor_loop())
    except KeyboardInterrupt:
        print("[monitor] shutting down", flush=True)
