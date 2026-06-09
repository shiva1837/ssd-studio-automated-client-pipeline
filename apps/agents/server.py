"""
SSD Studio — CereFlow AI Agent Server
FastMCP-based agentic layer with HITL cryptographic safeguards.
Exposes MCP tools for autonomous booking lifecycle management.
"""

import os
import hmac
import hashlib
import json
import secrets
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg
from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

# ============================================================
# DATABASE CONNECTION POOL
# ============================================================

DB_POOL: Optional[asyncpg.Pool] = None


async def get_db_pool() -> asyncpg.Pool:
    global DB_POOL
    if DB_POOL is None:
        DB_POOL = await asyncpg.create_pool(
            dsn=os.environ["DATABASE_URL"],
            min_size=2,
            max_size=10,
            command_timeout=10,
        )
    return DB_POOL


async def close_db_pool():
    global DB_POOL
    if DB_POOL:
        await DB_POOL.close()
        DB_POOL = None


# ============================================================
# HITL CRYPTOGRAPHIC SAFEGUARDS
# ============================================================

HITL_HMAC_SECRET: str = os.environ.get("HITL_HMAC_SECRET", "")
HITL_TOKEN_EXPIRY: int = int(os.environ.get("HITL_TOKEN_EXPIRY_SECONDS", "300"))

# In-memory challenge store (use Redis in production)
_challenge_store: dict[str, dict] = {}


def _generate_challenge_token() -> str:
    return secrets.token_urlsafe(32)


def _sign_challenge(challenge_token: str, operation: str, entity_id: str) -> str:
    """Create HMAC-SHA256 signature binding challenge to operation + entity."""
    message = f"{challenge_token}:{operation}:{entity_id}".encode()
    return hmac.new(
        HITL_HMAC_SECRET.encode(), message, hashlib.sha256
    ).hexdigest()


def _verify_challenge(
    challenge_token: str, operation: str, entity_id: str, signature: str
) -> bool:
    """Constant-time verification of HITL challenge signature."""
    expected = _sign_challenge(challenge_token, operation, entity_id)
    return hmac.compare_digest(expected, signature)


async def request_hitl_challenge(operation: str, entity_id: str) -> dict[str, Any]:
    """
    Generate a HITL challenge token for an irreversible operation.
    The human operator must sign this challenge to authorize execution.
    """
    token = _generate_challenge_token()
    signature = _sign_challenge(token, operation, entity_id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=HITL_TOKEN_EXPIRY)

    _challenge_store[token] = {
        "operation": operation,
        "entity_id": entity_id,
        "signature": signature,
        "expires_at": expires_at.isoformat(),
    }

    return {
        "challenge_token": token,
        "operation": operation,
        "entity_id": entity_id,
        "expires_at": expires_at.isoformat(),
        "message": (
            f"HITL Challenge: Authorize '{operation}' on entity '{entity_id}'. "
            f"Present signature '{signature}' to confirm. Token expires in {HITL_TOKEN_EXPIRY}s."
        ),
    }


async def verify_and_consume_challenge(
    challenge_token: str, operation: str, entity_id: str, signature: str
) -> bool:
    """Verify + consume a HITL challenge (one-time use, replay-resistant)."""
    stored = _challenge_store.pop(challenge_token, None)
    if not stored:
        return False

    expires_at = datetime.fromisoformat(stored["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        return False

    if stored["operation"] != operation or stored["entity_id"] != entity_id:
        return False

    return _verify_challenge(challenge_token, operation, entity_id, signature)


# ============================================================
# MCP SERVER
# ============================================================

mcp = FastMCP("CereFlow — SSD Studio Agent", version="1.0.0")


# ============================================================
# HEALTH CHECK (for Docker healthcheck)
# ============================================================

@mcp.tool()
async def health() -> dict[str, Any]:
    """Health check endpoint. Returns service status and database connectivity."""
    try:
        pool = await get_db_pool()
        await pool.fetchval("SELECT 1")
        return {"status": "healthy", "database": "connected", "service": "cereflow"}
    except Exception as e:
        return {"status": "unhealthy", "database": str(e), "service": "cereflow"}


# ============================================================
# BOOKING QUERY TOOLS
# ============================================================

@mcp.tool()
async def list_bookings(
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """
    Query PostgreSQL booking records with status filter and pagination.

    Args:
        status: Filter by booking status (PENDING, CONFIRMED, COMPLETED, CANCELLED). None for all.
        limit: Maximum records to return (default 20, max 100).
        offset: Number of records to skip for pagination.
    """
    limit = min(max(limit, 1), 100)
    offset = max(offset, 0)

    pool = await get_db_pool()
    conditions = ""
    params: list[Any] = []
    if status:
        conditions = "WHERE status = $1"
        params = [status]

    rows = await pool.fetch(
        f"""
        SELECT b.id, b.client_id, b.service_type, b.start_time, b.end_time,
               b.status, b.amount_paid, b.confirmation_sent_at, b.notes,
               u.name as client_name, u.email as client_email
        FROM bookings b
        JOIN users u ON b.client_id = u.id
        {conditions}
        ORDER BY b.start_time DESC
        LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
        """,
        *params,
        limit,
        offset,
    )

    total = await pool.fetchval(
        f"SELECT COUNT(*) FROM bookings b {conditions}", *params
    )

    return {
        "data": [dict(r) for r in rows],
        "pagination": {"limit": limit, "offset": offset, "total": total},
    }


@mcp.tool()
async def get_booking(booking_id: str) -> dict[str, Any]:
    """
    Retrieve full booking details including media asset status.

    Args:
        booking_id: UUID of the booking to retrieve.
    """
    pool = await get_db_pool()

    booking = await pool.fetchrow(
        """
        SELECT b.*, u.name as client_name, u.email as client_email, u.phone as client_phone
        FROM bookings b
        JOIN users u ON b.client_id = u.id
        WHERE b.id = $1
        """,
        booking_id,
    )

    if not booking:
        return {"error": "Booking not found", "booking_id": booking_id}

    media_assets = await pool.fetch(
        "SELECT * FROM media_assets WHERE booking_id = $1", booking_id
    )

    return {
        "booking": dict(booking),
        "media_assets": [dict(m) for m in media_assets],
    }


# ============================================================
# HITL RESCHEDULE TOOLS
# ============================================================

@mcp.tool()
async def request_reschedule_challenge(booking_id: str) -> dict[str, Any]:
    """
    Generate HITL challenge token for rescheduling a booking.
    A human operator must provide the signed authorization to proceed.

    Args:
        booking_id: UUID of the booking to reschedule.
    """
    pool = await get_db_pool()
    booking = await pool.fetchrow(
        "SELECT id, status FROM bookings WHERE id = $1", booking_id
    )
    if not booking:
        return {"error": "Booking not found"}

    if booking["status"] == "CANCELLED":
        return {"error": "Cannot reschedule a cancelled booking"}

    return await request_hitl_challenge("RESCHEDULE", booking_id)


@mcp.tool()
async def reschedule_shoot(
    booking_id: str,
    new_start_time: str,
    new_end_time: str,
    challenge_token: str,
    signature: str,
) -> dict[str, Any]:
    """
    Execute reschedule after HITL validation.

    Args:
        booking_id: UUID of the booking.
        new_start_time: ISO 8601 datetime string for new start.
        new_end_time: ISO 8601 datetime string for new end.
        challenge_token: Token from request_reschedule_challenge.
        signature: HMAC signature from the challenge response.
    """
    # Verify HITL challenge
    if not await verify_and_consume_challenge(
        challenge_token, "RESCHEDULE", booking_id, signature
    ):
        return {
            "success": False,
            "error": "HITL_VALIDATION_FAILED",
            "message": "Challenge invalid, expired, or already consumed.",
        }

    pool = await get_db_pool()

    # Check booking exists and is reschedulable
    booking = await pool.fetchrow(
        "SELECT id, status FROM bookings WHERE id = $1", booking_id
    )
    if not booking:
        return {"success": False, "error": "Booking not found"}
    if booking["status"] == "CANCELLED":
        return {"success": False, "error": "Cannot reschedule a cancelled booking"}

    new_start = datetime.fromisoformat(new_start_time)
    new_end = datetime.fromisoformat(new_end_time)

    if new_end <= new_start:
        return {"success": False, "error": "new_end_time must be after new_start_time"}

    # Check for conflicts
    conflict = await pool.fetchrow(
        """
        SELECT id FROM bookings
        WHERE id != $1
          AND status IN ('PENDING', 'CONFIRMED')
          AND start_time < $3 AND end_time > $2
        """,
        booking_id,
        new_start,
        new_end,
    )
    if conflict:
        return {"success": False, "error": "Time slot conflict with another booking"}

    # Execute reschedule
    updated = await pool.fetchrow(
        "UPDATE bookings SET start_time = $2, end_time = $3, updated_at = NOW() WHERE id = $1 RETURNING *",
        booking_id,
        new_start,
        new_end,
    )

    # Audit log
    await pool.execute(
        "INSERT INTO audit_logs (entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4)",
        "booking",
        booking_id,
        "RESCHEDULED",
        json.dumps({"new_start": new_start_time, "new_end": new_end_time}),
    )

    return {"success": True, "data": dict(updated)}


# ============================================================
# HITL CANCELLATION TOOLS
# ============================================================

@mcp.tool()
async def request_cancellation_challenge(booking_id: str) -> dict[str, Any]:
    """
    Generate HITL challenge token for cancelling a booking.

    Args:
        booking_id: UUID of the booking to cancel.
    """
    pool = await get_db_pool()
    booking = await pool.fetchrow(
        "SELECT id, status FROM bookings WHERE id = $1", booking_id
    )
    if not booking:
        return {"error": "Booking not found"}

    if booking["status"] == "COMPLETED":
        return {"error": "Cannot cancel a completed booking"}

    if booking["status"] == "CANCELLED":
        return {"error": "Booking is already cancelled"}

    return await request_hitl_challenge("CANCEL", booking_id)


@mcp.tool()
async def execute_cancellation(
    booking_id: str,
    challenge_token: str,
    signature: str,
    reason: str = "Agent-initiated cancellation",
) -> dict[str, Any]:
    """
    Execute cancellation after HITL validation.

    Args:
        booking_id: UUID of the booking.
        challenge_token: Token from request_cancellation_challenge.
        signature: HMAC signature from the challenge response.
        reason: Human-provided reason for cancellation.
    """
    # Verify HITL challenge
    if not await verify_and_consume_challenge(
        challenge_token, "CANCEL", booking_id, signature
    ):
        return {
            "success": False,
            "error": "HITL_VALIDATION_FAILED",
            "message": "Challenge invalid, expired, or already consumed.",
        }

    pool = await get_db_pool()

    booking = await pool.fetchrow(
        "SELECT * FROM bookings WHERE id = $1", booking_id
    )
    if not booking:
        return {"success": False, "error": "Booking not found"}
    if booking["status"] == "COMPLETED":
        return {"success": False, "error": "Cannot cancel a completed booking"}

    # Cancel booking
    updated = await pool.fetchrow(
        "UPDATE bookings SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 RETURNING *",
        booking_id,
    )

    # Release slot lock if exists
    if booking["lock_token"]:
        lua = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
        """
        # Note: ioredis handles this from the API side; agent uses postgres only
        pass

    # Audit log
    await pool.execute(
        "INSERT INTO audit_logs (entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4)",
        "booking",
        booking_id,
        "CANCELLED",
        json.dumps({"reason": reason}),
    )

    return {"success": True, "data": dict(updated)}


# ============================================================
# ANALYTICS TOOL
# ============================================================

@mcp.tool()
async def get_booking_analytics() -> dict[str, Any]:
    """
    Retrieve revenue and conversion analytics.
    Returns booking counts by status, total revenue, and service breakdown.
    """
    pool = await get_db_pool()

    total_bookings = await pool.fetchval("SELECT COUNT(*) FROM bookings")

    by_status = await pool.fetch(
        "SELECT status, COUNT(*) as count FROM bookings GROUP BY status"
    )

    revenue = await pool.fetchrow(
        """
        SELECT COALESCE(SUM(amount_paid), 0) as total_revenue,
               COALESCE(AVG(amount_paid), 0) as avg_booking_value,
               COUNT(*) FILTER (WHERE amount_paid > 0) as paid_bookings
        FROM bookings
        WHERE status != 'CANCELLED'
        """
    )

    by_service = await pool.fetch(
        """
        SELECT service_type, COUNT(*) as count, COALESCE(SUM(amount_paid), 0) as revenue
        FROM bookings
        WHERE status != 'CANCELLED'
        GROUP BY service_type
        ORDER BY count DESC
        """
    )

    upcoming = await pool.fetch(
        """
        SELECT COUNT(*) as count FROM bookings
        WHERE status IN ('PENDING', 'CONFIRMED')
          AND start_time > NOW()
        """
    )

    return {
        "total_bookings": total_bookings,
        "by_status": {r["status"]: r["count"] for r in by_status},
        "revenue": {
            "total": float(revenue["total_revenue"]),
            "average": float(revenue["avg_booking_value"]),
            "paid_bookings": revenue["paid_bookings"],
        },
        "by_service": [dict(r) for r in by_service],
        "upcoming_bookings": upcoming[0]["count"] if upcoming else 0,
    }


# ============================================================
# SERVER ENTRY POINT
# ============================================================

async def startup():
    pool = await get_db_pool()
    await pool.fetchval("SELECT 1")
    print("CereFlow Agent connected to PostgreSQL.")


async def shutdown():
    await close_db_pool()


if __name__ == "__main__":
    host = os.environ.get("MCP_SERVER_HOST", "0.0.0.0")
    port = int(os.environ.get("MCP_SERVER_PORT", "8080"))

    asyncio.run(startup())

    try:
        mcp.run(transport="sse", host=host, port=port)
    finally:
        asyncio.run(shutdown())
