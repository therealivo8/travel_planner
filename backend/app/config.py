from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/travel_planner"
    secret_key: str = "changeme"
    environment: str = "development"
    # Comma-separated list of allowed CORS origins, e.g. "https://myapp.vercel.app,https://myapp.com"
    cors_origins: str = "http://localhost:3000"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    algorithm: str = "HS256"
    maps_api_key: str = ""
    ors_api_key: str = ""
    # Sentry error-tracking DSN. Empty (the default) disables Sentry entirely —
    # sentry_sdk.init() is a no-op without a DSN, so local dev needs no Sentry
    # account. Sentry DSNs are designed to be write-only and rate-limited by
    # project, so this is not treated as a secret the way SECRET_KEY is.
    sentry_dsn: str = ""

    # Phase 14 cost guardrails. Budgets are units per UTC day / calendar month per
    # upstream SKU, enforced by app.core.budget before each paid call. Overridable as
    # one JSON env var (API_BUDGETS) so Railway can change them without a deploy.
    # Defaults sit at ~90% of each provider's free allowance, so normal use costs $0.
    api_budgets: dict[str, dict[str, int]] = {
        "google.nearby_search": {"day": 150, "month": 4500},  # Pro free = 5,000
        "google.distance_matrix_element": {"day": 300, "month": 9000},  # Essentials = 10,000
        "google.directions": {"day": 300, "month": 9000},
        "google.geocode": {"day": 300, "month": 9000},
        "ors.isochrone": {"day": 400, "month": 1_000_000},  # ORS hard limit 500/day
    }
    # Free monthly allowance and overage price per unit, used only for the usage page's
    # estimated-cost column.
    api_free_allowance: dict[str, int] = {
        "google.nearby_search": 5000,
        "google.distance_matrix_element": 10000,
        "google.directions": 10000,
        "google.geocode": 10000,
    }
    api_unit_price_usd: dict[str, float] = {
        "google.nearby_search": 0.032,
        "google.distance_matrix_element": 0.005,
        "google.directions": 0.005,
        "google.geocode": 0.005,
    }
    # Per-user daily caps on expensive actions (Postgres-backed, survive deploys).
    user_daily_quotas: dict[str, int] = {
        "radius_discover": 8,
        "corridor_discover": 4,
        "optimize_day": 20,
        "build_itinerary": 20,
        "calculate_route": 40,
    }
    discovery_cache_ttl_days: int = 7
    isochrone_cache_ttl_days: int = 90
    # Unselected stored suggestions older than this are deleted daily (Google terms).
    suggestion_retention_days: int = 30
    # Password-reset email (Resend). With no key the reset link is logged instead, so local
    # development needs no account — same pattern as sentry_dsn.
    resend_api_key: str = ""
    email_from: str = "Road Trip Planner <onboarding@resend.dev>"
    # Public origin of the frontend, used to build links in emails.
    frontend_url: str = "http://localhost:3000"
    # Phase 17: Cloudflare R2 (S3-compatible) for trip photos. With no credentials the
    # photo endpoints answer 503 and everything else works.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    # Public custom-domain origin for the bucket, used only for photos on trips whose
    # recap is shared. Private trips always use short-lived presigned URLs.
    r2_public_base_url: str = ""
    photos_per_trip: int = 50
    photos_per_user: int = 500
    photo_max_upload_bytes: int = 5 * 1024 * 1024
    # Comma-separated emails allowed to view /admin/usage.
    admin_emails: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @field_validator("database_url", mode="after")
    @classmethod
    def _use_asyncpg_driver(cls, value: str) -> str:
        # Railway's Postgres plugin injects DATABASE_URL as "postgresql://..." (or the
        # legacy "postgres://..." some providers still use) — neither loads under
        # SQLAlchemy's async engine, which requires the explicit asyncpg driver in the
        # scheme. Normalize instead of requiring the value to be hand-edited per deploy.
        if value.startswith("postgresql+asyncpg://"):
            return value
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value[len("postgresql://") :]
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value[len("postgres://") :]
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def admin_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @model_validator(mode="after")
    def _forbid_default_secret_key_in_production(self) -> "Settings":
        # "changeme" is committed in source, so a prod deploy with a missing/unset
        # SECRET_KEY env var would otherwise boot fine and sign real JWTs with a
        # publicly known key. Fail startup instead of accepting requests silently.
        if self.environment == "production" and self.secret_key == "changeme":
            raise ValueError(
                "SECRET_KEY must be set to a real value when ENVIRONMENT=production. "
                "Refusing to start with the default placeholder key."
            )
        return self


settings = Settings()
