from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
from app.api.waypoints import router as waypoints_router
from app.config import settings
from app.core.limiter import limiter

app = FastAPI(
    title="Road Trip Planner API",
    description="Backend API for the Road Trip Planner application.",
    version="0.2.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
