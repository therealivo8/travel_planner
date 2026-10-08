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
from app.api.expenses import router as expenses_router
from app.api.export import router as export_router
from app.api.health import router as health_router
from app.api.itinerary import router as itinerary_router
from app.api.map import router as map_router
from app.api.members import router as members_router
from app.api.navigation import router as navigation_router
from app.api.packing import router as packing_router
from app.api.photos import router as photos_router
from app.api.radius import router as radius_router
from app.api.recap import router as recap_router
from app.api.routing import router as routing_router
from app.api.sharing import router as sharing_router
from app.api.social import router as social_router
from app.api.trips import router as trips_router
from app.api.usage import router as usage_router
from app.api.waypoints import router as waypoints_router
from app.api.weather import router as weather_router
from app.config import settings
from app.core.budget import BudgetExceeded, UserQuotaExceeded
from app.core.cleanup import cleanup_loop
from app.core.limiter import limiter
from app.core.logging_config import configure_logging
from app.core.security_log import log_rate_limited
from app.core.sentry import init_sentry
from app.core.trip_access import VersionConflictError, request_state

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


async def _handle_version_conflict(request: Request, exc: VersionConflictError) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": "Someone else just changed this trip. Reload to see their changes.",
            "code": "version_conflict",
            "version": exc.current_version,
        },
        headers={"X-Trip-Version": str(exc.current_version)},
    )


app.add_exception_handler(VersionConflictError, _handle_version_conflict)  # type: ignore[arg-type]
app.add_exception_handler(BudgetExceeded, _handle_budget_exceeded)  # type: ignore[arg-type]
app.add_exception_handler(UserQuotaExceeded, _handle_user_quota)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceeded, _log_and_handle_rate_limit)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Trip-Version"],
)


@app.middleware("http")
async def trip_version_state(request: Request, call_next: Any) -> Response:
    """Expose the caller's If-Match version to the access layer, and the trip's new version
    (set by touch_trip) back to the caller as X-Trip-Version."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return await call_next(request)  # type: ignore[no-any-return]
    raw = request.headers.get("if-match", "").strip().strip('"')
    state: dict[str, Any] = {"if_match": int(raw) if raw.isdigit() else None, "version": None}
    token = request_state.set(state)
    try:
        response: Response = await call_next(request)
    finally:
        request_state.reset(token)
    if state["version"] is not None:
        response.headers["X-Trip-Version"] = str(state["version"])
    return response


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
app.include_router(expenses_router)
app.include_router(weather_router)
app.include_router(packing_router)
app.include_router(navigation_router)
app.include_router(photos_router)
app.include_router(recap_router)
app.include_router(map_router)
app.include_router(members_router)
app.include_router(social_router)
