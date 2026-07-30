"""Better Auth session validation (cookie → Session table)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Cookie, Header, HTTPException, Request

from app.db import get_pool

SESSION_COOKIE_CANDIDATES = (
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
)


def _parse_cookie_header(header: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    if not header:
        return out
    for part in header.split(";"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


async def resolve_user_id(
    request: Request,
    authorization: str | None = Header(default=None),
    cookie: str | None = Header(default=None, alias="cookie"),
) -> str:
    """
    Resolve authenticated user id from Better Auth session cookie.
    Also accepts Authorization: Bearer <session_token> for tooling.
    """
    token: str | None = None

    cookies = _parse_cookie_header(cookie) if cookie else {}
    # Starlette also parses cookies
    for name in SESSION_COOKIE_CANDIDATES:
        if name in request.cookies:
            token = request.cookies[name]
            break
        if name in cookies:
            token = cookies[name]
            break

    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

    if not token:
        raise HTTPException(status_code=401, detail={"message": "Unauthorized"})

    # Better Auth may store token as raw or signed token.token; try both
    candidates = [token]
    if "." in token:
        candidates.append(token.split(".", 1)[0])

    pool = await get_pool()
    row = None
    async with pool.acquire() as conn:
        for cand in candidates:
            row = await conn.fetchrow(
                """
                SELECT s."userId", s."expiresAt"
                FROM "Session" s
                WHERE s.token = $1
                LIMIT 1
                """,
                cand,
            )
            if row:
                break

    if not row:
        raise HTTPException(status_code=401, detail={"message": "Unauthorized"})

    expires = row["expiresAt"]
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail={"message": "Session expired"})

    return str(row["userId"])
