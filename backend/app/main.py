from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.core.config import get_settings
from app.modules.blueprint.router import router as blueprint_router
from app.modules.business_registration.router import router as registration_router
from app.modules.idea_validation.router import router as validation_router
from app.modules.scenario_intelligence.router import router as scenario_intelligence_router
from app.modules.simulation.router import router as simulation_router
from app.modules.workspace_profile.router import router as workspace_profile_router
from app.modules.service_ideas.router import router as service_ideas_router
from app.modules.upgrade.router import router as upgrade_router
from app.shared.auth.router import router as auth_router
from app.shared.utils.logging import configure_logging
from app.shared.utils.middleware import request_logging_middleware

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.environment)
    if settings.environment == "development":
        logger.info(
            "Config loaded env=%s cors_origins=%s supabase_enabled=%s",
            settings.environment,
            settings.cors_origins,
            bool(settings.supabase_url and settings.supabase_service_role_key),
        )
        logger.info(
            "LLM providers configured claude=%s gemini=%s openai=%s",
            bool(settings.claude_api_key),
            bool(settings.gemini_api_key),
            bool(settings.openai_api_key),
        )

    app = FastAPI(title=settings.app_name)

    if settings.environment == "development":
        allow_origins = list(dict.fromkeys(settings.cors_origins))
        cors_kwargs = dict(
            allow_origins=allow_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        # Allow localhost in dev and Render preview domains as a safe fallback.
        cors_kwargs["allow_origin_regex"] = r"(^https?://(localhost|127\.0\.0\.1)(:\d+)?$)|(^https?://.*\.onrender\.com$)"
    else:
        # Production: allow any origin (no cookies), to avoid blocked auth/signup across Render domains.
        cors_kwargs = dict(
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    if settings.environment == "development":
        app.middleware("http")(request_logging_middleware)

    app.include_router(auth_router)
    app.include_router(validation_router)
    app.include_router(workspace_profile_router)
    app.include_router(registration_router)
    app.include_router(blueprint_router)
    app.include_router(simulation_router)
    app.include_router(scenario_intelligence_router)
    app.include_router(upgrade_router)
    app.include_router(service_ideas_router)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/")
    async def root() -> dict:
        return {"status": "ok"}

    @app.head("/")
    async def root_head() -> None:
        return None

    return app


app = create_app()
