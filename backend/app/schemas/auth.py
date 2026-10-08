import uuid
from datetime import datetime
from typing import Literal

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


def _check_new_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    return v


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None
    units: Literal["imperial", "metric"] = "imperial"
    home_address: str | None = None
    home_lat: float | None = None
    home_lng: float | None = None
    default_stop_minutes: int = 60
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    units: Literal["imperial", "metric"] | None = None
    home_address: str | None = Field(default=None, max_length=2000)
    home_lat: float | None = Field(default=None, ge=-90, le=90)
    home_lng: float | None = Field(default=None, ge=-180, le=180)
    default_stop_minutes: int | None = Field(default=None, ge=1, le=1440)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)

    _check = field_validator("new_password")(_check_new_password)


class DeleteAccountRequest(BaseModel):
    password: str = Field(max_length=200)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(max_length=200)

    _check = field_validator("new_password")(_check_new_password)
