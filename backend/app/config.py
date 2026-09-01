from pydantic import model_validator
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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

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
