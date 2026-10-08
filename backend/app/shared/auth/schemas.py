from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # bcrypt limit is 72 bytes; enforce to avoid runtime errors
    password: str = Field(min_length=8, max_length=72)
    full_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    company: str | None = Field(default=None, max_length=150)
    ref_click_id: str | None = None
    ref_code: str | None = None
    marketing_opt_in: bool = False      # ticked by the person; never assumed from creating an account
    timezone: str | None = Field(default=None, max_length=64)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str | None = None
    picture: str | None = None
    auth_provider: str | None = None
    has_password: bool = False
    email_verification_sent: bool = False


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    # A small image as a data URL, or "" to remove the photo. Left out: unchanged.
    picture: str | None = Field(default=None, max_length=400_000)


class DeleteAccountRequest(BaseModel):
    confirm: str = Field(max_length=320)      # the account's email address, typed out


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=20)
    ref_click_id: str | None = None
    ref_code: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=72)
