"""Turn unhandled exceptions into clear JSON errors.

Without this, an unhandled exception is answered by Starlette's outermost error
handler, which sits outside the CORS middleware: the browser then sees a response
with no CORS headers, refuses to read it, and reports a network error instead of
the real problem. This middleware sits inside CORS, so every error response keeps
its CORS headers and carries a short machine-readable code the frontend can map
to a plain message.
"""
from __future__ import annotations

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.errors")


def _missing_table(exc: BaseException) -> bool:
    return getattr(exc, "code", None) == "PGRST205" or "PGRST205" in str(exc)


def describe(exc: BaseException) -> tuple[int, str, str]:
    """(HTTP status, error code, user-facing message) for an unhandled exception."""
    from app.core.supabase import _is_retriable

    if _missing_table(exc):
        return 503, "feature_unavailable", (
            "This feature isn't available yet because its database tables haven't been created. "
            "Please try again later."
        )
    if _is_retriable(exc):
        return 503, "service_unavailable", "We couldn't reach the database just now. It's safe to retry."
    return 500, "server_error", "Something went wrong on our side. It's safe to retry."


class CatchAllErrors:
    """Pure ASGI middleware (no BaseHTTPMiddleware), placed inside CORSMiddleware."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:  # noqa: BLE001 - this is the last line of defence
            if started:          # part of a response already went out; nothing safe to add
                raise
            status, code, message = describe(exc)
            logger.exception("Unhandled error on %s %s -> %s (%s)", scope.get("method"), scope.get("path"), status, code)
            await JSONResponse({"detail": message, "code": code}, status_code=status)(scope, receive, send)
