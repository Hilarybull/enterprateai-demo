from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            ".env",
            ".env.local",
            "../.env",
            "../.env.local",
            "backend/.env",
            "backend/.env.local",
        ),
        env_file_encoding="utf-8",
        enable_decoding=False,
        extra="ignore",
    )

    app_name: str = "EnterprateAI"
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    cors_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"], validation_alias=AliasChoices("CORS_ORIGINS", "FRONTEND_URL"))

    mongo_uri: str = Field(default="mongodb://localhost:27017", validation_alias=AliasChoices("MONGO_URI", "MONGO_URL"))
    mongo_db: str = Field(default="enterprateai", validation_alias=AliasChoices("MONGO_DB", "DB_NAME"))
    supabase_url: str | None = Field(default=None, validation_alias=AliasChoices("SUPABASE_URL", "PUBLIC_SUPABASE_URL"))
    supabase_service_role_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE"),
    )

    jwt_secret_key: str = Field(default="CHANGE_ME", validation_alias=AliasChoices("JWT_SECRET_KEY", "JWT_SECRET"))
    jwt_algorithm: str = Field(default="HS256", validation_alias=AliasChoices("JWT_ALGORITHM", "JWT_ALGO"))
    jwt_access_token_exp_minutes: int = Field(default=60 * 24, validation_alias=AliasChoices("JWT_ACCESS_TOKEN_EXP_MINUTES", "JWT_EXP_MINUTES"))

    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"

    # Optional AI integration keys (not required for MVP routes)
    claude_api_key: str | None = Field(default=None, validation_alias=AliasChoices("CLAUDE_API_KEY", "ANTHROPIC_API_KEY"))
    # Use a stable, explicit model id by default to avoid provider-side "Not Found"
    # errors when aliases like "*-latest" are not supported for an API key.
    claude_model: str = Field(default="claude-3-5-sonnet-20240620", validation_alias=AliasChoices("CLAUDE_MODEL",))
    gemini_api_key: str | None = Field(default=None, validation_alias=AliasChoices("GEMINI_API_KEY",))
    gemini_model: str = Field(default="gemini-1.5-flash", validation_alias=AliasChoices("GEMINI_MODEL",))
    allow_gemini_fallback: bool = Field(default=False, validation_alias=AliasChoices("ALLOW_GEMINI_FALLBACK",))
    emergent_llm_key: str | None = Field(default=None, validation_alias=AliasChoices("EMERGENT_LLM_KEY",))

    # Optional integrations (placeholders for future modules)
    companies_house_api_key: str | None = Field(default=None, validation_alias=AliasChoices("COMPANIES_HOUSE_API_KEY",))
    fred_api_key: str | None = Field(default=None, validation_alias=AliasChoices("FRED_API_KEY",))
    dataforseo_login: str | None = Field(default=None, validation_alias=AliasChoices("DATAFORSEO_LOGIN",))
    dataforseo_password: str | None = Field(default=None, validation_alias=AliasChoices("DATAFORSEO_PASSWORD",))
    google_places_api_key: str | None = Field(default=None, validation_alias=AliasChoices("GOOGLE_PLACES_API_KEY",))
    sendgrid_api_key: str | None = Field(default=None, validation_alias=AliasChoices("SENDGRID_API_KEY",))
    sendgrid_from_email: str | None = Field(default=None, validation_alias=AliasChoices("SENDGRID_FROM_EMAIL",))
    google_client_id: str | None = Field(default=None, validation_alias=AliasChoices("GOOGLE_CLIENT_ID",))
    google_client_secret: str | None = Field(default=None, validation_alias=AliasChoices("GOOGLE_CLIENT_SECRET",))

    # Stripe
    stripe_secret_key: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_SECRET_KEY",))
    stripe_webhook_secret: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_WEBHOOK_SECRET",))
    stripe_price_insight_starter_monthly: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_PRICE_INSIGHT_STARTER_MONTHLY",))
    stripe_price_insight_starter_annual: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_PRICE_INSIGHT_STARTER_ANNUAL",))
    stripe_price_decision_engine_monthly: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_PRICE_DECISION_ENGINE_MONTHLY",))
    stripe_price_decision_engine_annual: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_PRICE_DECISION_ENGINE_ANNUAL",))
    stripe_price_strategic_intelligence_monthly: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_PRICE_STRATEGIC_INTELLIGENCE_MONTHLY",))
    stripe_price_strategic_intelligence_annual: str | None = Field(default=None, validation_alias=AliasChoices("STRIPE_PRICE_STRATEGIC_INTELLIGENCE_ANNUAL",))
    frontend_url: str = Field(default="http://localhost:5173", validation_alias=AliasChoices("FRONTEND_URL", "CORS_ORIGINS"))

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):
        if v is None:
            return v
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            return [part.strip() for part in s.split(",") if part.strip()]
        return v


@lru_cache
def _get_cached_settings() -> Settings:
    return Settings()


def get_settings(*, refresh: bool = False) -> Settings:
    if refresh:
        _get_cached_settings.cache_clear()
    return _get_cached_settings()
