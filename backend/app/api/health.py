from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    # Liveness only — no DB round-trip. This is Railway's healthcheckPath; a slow-to-accept
    # DB connection on cold boot must not make Railway kill and restart the container.
    return {"status": "ok"}


@router.get("/health/db")
async def health_check_db(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
