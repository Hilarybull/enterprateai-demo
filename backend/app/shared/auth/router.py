from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.database import get_db
from app.shared.auth.google import verify_google_id_token
from app.shared.auth.schemas import GoogleAuthRequest, LoginRequest, RegisterRequest, TokenResponse, UserPublic
from app.shared.auth.security import create_access_token, hash_password, verify_password
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserPublic)
async def register(payload: RegisterRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> UserPublic:
    existing = await db["users"].find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user_doc = {"_id": payload.email.lower(), "email": payload.email.lower(), "password_hash": hash_password(payload.password)}
    await db["users"].insert_one(user_doc)
    return UserPublic(id=user_doc["_id"], email=user_doc["email"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> TokenResponse:
    user = await db["users"].find_one({"_id": payload.email.lower()})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(subject=user["_id"])
    return TokenResponse(access_token=token)


@router.post("/google", response_model=TokenResponse)
async def google_auth(payload: GoogleAuthRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> TokenResponse:
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Google auth not configured")

    identity = verify_google_id_token(credential=payload.credential, audience=settings.google_client_id)

    # Upsert user by email to keep user_id stable across auth methods.
    existing = await db["users"].find_one({"_id": identity.email})
    if not existing:
        await db["users"].insert_one(
            {
                "_id": identity.email,
                "email": identity.email,
                "auth_provider": "google",
                "google_sub": identity.sub,
                "name": identity.name,
                "picture": identity.picture,
            }
        )
    else:
        await db["users"].update_one(
            {"_id": identity.email},
            {"$set": {"auth_provider": existing.get("auth_provider") or "google", "google_sub": identity.sub, "name": identity.name, "picture": identity.picture}},
        )

    token = create_access_token(subject=identity.email)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserPublic)
async def me(user=Depends(get_current_user)) -> UserPublic:
    return UserPublic(id=user["id"], email=user["email"])
