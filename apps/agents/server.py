"""
SSD Studio — CereFlow FastMCP Agent Server
===========================================
Exposes booking-pipeline control tools to an LLM client over MCP (SSE transport).

Irreversible operations (reschedule, cancellation) are gated behind a
two-step HMAC-SHA256 Human-in-the-Loop (HITL) challenge/response so a
prompt-injection cannot trigger destructive actions on its own.

Run:  python server.py     (serves SSE on AGENT_HOST:AGENT_PORT)
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Any, Optional

import asyncpg
from mcp.server.fastmcp import FastMCP

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "")
HITL_HMAC_SECRET = os.environ.get("HITL_HMAC_SECRET", "")
HITL_TOKEN_EXPIRY_SECONDS = int(os.environ.get("HITL_TOKEN_EXPIRY_SECONDS", "300"))
AGENT_HOST = os.environ.get("AGENT_HOST", "0.0.0.0")
AGENT_PORT = int(os.environ.get("AGENT_PORT", "8080"))

mcp = FastMCP("cereflow", host=AGENT_HOST, port=AGENT_PORT)

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """Lazily create and reuse a single asyncpg connection pool."""
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        _pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=1, max_size=5)
    return _pool


# ------------------------------------------------------------------
# HITL cryptographic safeguard
# ------------------------------------------------------------------
def _sign(operation: str, entity_id: str, issued_at: int) -> str:
    msg = f"{operation}:{entity_id}:{issued_at}".encode()
    return hmac.new(HITL_HMAC_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def issue_challenge(operation: str, entity_id: str) -> dict[str, Any]:
    """Create a time-bound, operation-scoped challenge token."""
    if not HITL_HMAC_SECRET:
        raise RuntimeError("HITL_HMAC_SECRET is not configured")
    issued_at = int(time.time())
    signature = _sign(operation, entity_id, issued_at)
    token = f"{issued_at}.{signature}"
    return {
        "challenge_token": token,
        "operation": operation,
        "entity_id": entity_id,
        "expires_in_seconds": HITL_TOKEN_EXPIRY_SECONDS,
        "instructions": (
            "A human operator must confirm this action by passing this "
            "challenge_token back to the matching execute_* tool."
        ),
    }


def verify_challenge(operation: str, entity_id: str, token: str) -> bool:
    """Constant-time verification of a HITL challenge token."""
    try:
        issued_str, signature = token.split(".", 1)
        issued_at = int(issued_str)
    except (ValueError, AttributeError):
        return False
    if int(time.time()) - issued_at > HITL_TOKEN_EXPIRY_SECONDS:
        return False
    expected = _sign(operation, entity_id, issued_at)
    return hmac.compare_digest(expected, signature)


# ------------------------------------------------------------------
# Read tools
# ------------------------------------------------------------------
@mcp.tool()
async def list_bookings(status: Optional[str] = None, limit: int = 20) -> list[dict[str, Any]]:
    """List bookings, optionally filtered by status (PENDING/CONFIRMED/COMPLETED/CANCELLED)."""
    pool = await get_pool()
    limit = max(1, min(100, limit))
    async with pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                "SELECT id, \"serviceType\", \"startTime\", \"endTime\", status, \"amountPaid\" "
                "FROM bookings WHERE status = $1 ORDER BY \"startTime\" DESC LIMIT $2",
                status, limit,
            )
        else:
            rows = await conn.fetch(
                "SELECT id, \"serviceType\", \"startTime\", \"endTime\", status, \"amountPaid\" "
                "FROM bookings ORDER BY \"startTime\" DESC LIMIT $1",
                limit,
            )
    return [dict(r) for r in rows]


@mcp.tool()
async def get_booking(booking_id: str) -> dict[str, Any]:
    """Retrieve full details for a single booking, including its media assets."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        booking = await conn.fetchrow("SELECT * FROM bookings WHERE id = $1", booking_id)
        if booking is None:
            return {"error": "not_found", "booking_id": booking_id}
        assets = await conn.fetch(
            "SELECT id, \"assetType\", \"deliveryStatus\" FROM media_assets WHERE \"bookingId\" = $1",
            booking_id,
        )
    result = dict(booking)
    result["mediaAssets"] = [dict(a) for a in assets]
    return result


@mcp.tool()
async def get_system_logs(level: Optional[str] = None, unresolved_only: bool = True, limit: int = 50) -> list[dict[str, Any]]:
    """Inspect SystemLog entries for observability and triage."""
    pool = await get_pool()
    limit = max(1, min(200, limit))
    clauses, args = [], []
    if level:
        args.append(level)
        clauses.append(f"level = ${len(args)}")
    if unresolved_only:
        clauses.append("resolved = false")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT id, level, source, message, resolved, \"createdAt\" "
            f"FROM system_logs {where} ORDER BY \"createdAt\" DESC LIMIT ${len(args) + 1}",
            *args, limit,
        )
    return [dict(r) for r in rows]


# ------------------------------------------------------------------
# HITL-gated write tools
# ------------------------------------------------------------------
@mcp.tool()
async def request_reschedule_challenge(booking_id: str) -> dict[str, Any]:
    """Step 1 of reschedule: obtain a HITL challenge token for human confirmation."""
    return issue_challenge("reschedule", booking_id)


@mcp.tool()
async def reschedule_shoot(
    booking_id: str, new_start_iso: str, new_end_iso: str, challenge_token: str
) -> dict[str, Any]:
    """Step 2 of reschedule: apply new times AFTER validating the HITL token."""
    if not verify_challenge("reschedule", booking_id, challenge_token):
        return {"error": "hitl_validation_failed", "booking_id": booking_id}
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Re-check for overlapping active bookings before moving (defensive).
        conflict = await conn.fetchrow(
            "SELECT id FROM bookings WHERE status IN ('PENDING','CONFIRMED') "
            "AND id <> $1 AND \"startTime\" < $3 AND \"endTime\" > $2",
            booking_id, new_start_iso, new_end_iso,
        )
        if conflict:
            return {"error": "slot_conflict", "conflicting_id": conflict["id"]}
        await conn.execute(
            "UPDATE bookings SET \"startTime\" = $2, \"endTime\" = $3, \"updatedAt\" = now() WHERE id = $1",
            booking_id, new_start_iso, new_end_iso,
        )
    return {"success": True, "booking_id": booking_id, "new_start": new_start_iso, "new_end": new_end_iso}


@mcp.tool()
async def request_cancellation_challenge(booking_id: str) -> dict[str, Any]:
    """Step 1 of cancellation: obtain a HITL challenge token for human confirmation."""
    return issue_challenge("cancellation", booking_id)


@mcp.tool()
async def execute_cancellation(booking_id: str, challenge_token: str) -> dict[str, Any]:
    """Step 2 of cancellation: cancel the booking AFTER validating the HITL token.

    Note: this performs a soft cancel (status = CANCELLED). It never deletes data.
    """
    if not verify_challenge("cancellation", booking_id, challenge_token):
        return {"error": "hitl_validation_failed", "booking_id": booking_id}
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT status FROM bookings WHERE id = $1", booking_id)
        if row is None:
            return {"error": "not_found", "booking_id": booking_id}
        if row["status"] == "COMPLETED":
            return {"error": "already_completed", "booking_id": booking_id}
        await conn.execute(
            "UPDATE bookings SET status = 'CANCELLED', \"updatedAt\" = now() WHERE id = $1",
            booking_id,
        )
    return {"success": True, "booking_id": booking_id, "status": "CANCELLED"}


if __name__ == "__main__":
    # SSE transport for remote LLM clients.
    mcp.run(transport="sse")
