import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    # Upper bound isn't about UX (nobody has a 200-char password) — it's
    # because bcrypt (app.core.security.hash_password) silently truncates
    # at 72 bytes, and hashing an arbitrarily long client-supplied string
    # is wasted CPU with no security benefit past that point.
    password: str = Field(max_length=200)
    display_name: str | None = Field(default=None, max_length=200)

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
