import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.auth import router as auth_router
from app.api.corridor import router as corridor_router
from app.api.export import router as export_router
from app.api.health import router as health_router
from app.api.itinerary import router as itinerary_router
from app.api.radius import router as radius_router
from app.api.routing import router as routing_router
from app.api.sharing import router as sharing_router
from app.api.trips import router as trips_router
from app.api.usage import router as usage_router
from app.api.waypoints import router as waypoints_router
from app.config import settings
from app.core.budget import BudgetExceeded, UserQuotaExceeded
from app.core.cleanup import cleanup_loop
from app.core.limiter import limiter
from app.core.logging_config import configure_logging
from app.core.security_log import log_rate_limited
from app.core.sentry import init_sentry

# Order matters: logging must be configured, and Sentry initialized, before
# the FastAPI app is constructed below, so every request the app handles is
# covered from the very first one — not just requests after some later
# startup step.
configure_logging()
init_sentry()

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Daily purge of stale stored suggestions and expired cache rows (Phase 14).
    task = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="Road Trip Planner API",
    description="Backend API for the Road Trip Planner application.",
    version="0.2.0",
    lifespan=lifespan,
)

app.state.limiter = limiter


def _log_and_handle_rate_limit(request: Request, exc: RateLimitExceeded) -> Response:
    # slowapi's own handler is synchronous — no await here. Logged as a
    # security event before delegating to it for the actual 429 +
    # Retry-After response.
    log_rate_limited(request)
    return _rate_limit_exceeded_handler(request, exc)


def _retry_after(resets_at: datetime) -> str:
    return str(max(1, int((resets_at - datetime.now(UTC)).total_seconds())))


async def _handle_budget_exceeded(request: Request, exc: BudgetExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Discovery is paused until the shared API budget resets — "
            "your saved suggestions are still available.",
            "code": "budget_exhausted",
            "resets_at": exc.resets_at.isoformat(),
        },
        headers={"Retry-After": _retry_after(exc.resets_at)},
    )


async def _handle_user_quota(request: Request, exc: UserQuotaExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "detail": "You've used today's allowance for this action. It resets tomorrow.",
            "code": "user_quota",
            "action": exc.action,
            "limit": exc.limit,
            "resets_at": exc.resets_at.isoformat(),
        },
        headers={"Retry-After": _retry_after(exc.resets_at)},
    )


app.add_exception_handler(BudgetExceeded, _handle_budget_exceeded)  # type: ignore[arg-type]
app.add_exception_handler(UserQuotaExceeded, _handle_user_quota)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceeded, _log_and_handle_rate_limit)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next: Any) -> Response:
    response: Response = await call_next(request)
    # No CSP here: this API serves JSON, not documents, so a policy governing
    # resource loading has nothing to act on. CSP belongs on the frontend.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if settings.environment == "production":
        # Only over HTTPS — sending HSTS on plaintext local dev would pin
        # localhost to https:// in the browser and break it persistently.
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(trips_router)
app.include_router(waypoints_router)
app.include_router(routing_router)
app.include_router(radius_router)
app.include_router(corridor_router)
app.include_router(itinerary_router)
app.include_router(sharing_router)
app.include_router(export_router)
app.include_router(usage_router)
