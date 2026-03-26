from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.core.config import get_settings
from app.core.database import close_mongo_connection, connect_to_mongo
from app.modules.blueprint.router import router as blueprint_router
from app.modules.business_registration.router import router as registration_router
from app.modules.idea_validation.router import router as validation_router
from app.modules.scenario_intelligence.router import router as scenario_intelligence_router
from app.modules.simulation.router import router as simulation_router
from app.shared.auth.router import router as auth_router
from app.shared.utils.logging import configure_logging
from app.shared.utils.middleware import request_logging_middleware
from app.shared.utils.redact import redact_uri

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.environment)
    if settings.environment == "development":
        logger.info(
            "Config loaded env=%s mongo_uri=%s mongo_db=%s cors_origins=%s",
            settings.environment,
            redact_uri(settings.mongo_uri),
            settings.mongo_db,
            settings.cors_origins,
        )
        logger.info(
            "LLM providers configured claude=%s gemini=%s openai=%s",
            bool(settings.claude_api_key),
            bool(settings.gemini_api_key),
            bool(settings.openai_api_key),
        )

    app = FastAPI(title=settings.app_name)

    allow_origins = list(dict.fromkeys(settings.cors_origins))
    if settings.environment != "development":
        # Ensure Render demo origin is explicitly allowed even if env parsing fails.
        allow_origins.extend(
            [
                "https://enterprateai-demo.onrender.com",
            ]
        )
        allow_origins = list(dict.fromkeys(allow_origins))

    cors_kwargs = dict(
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Allow localhost in dev and Render preview domains as a safe fallback.
    cors_kwargs["allow_origin_regex"] = r"(^https?://(localhost|127\.0\.0\.1)(:\d+)?$)|(^https?://.*\.onrender\.com$)"
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    if settings.environment == "development":
        app.middleware("http")(request_logging_middleware)

    @app.on_event("startup")
    async def _startup() -> None:
        await connect_to_mongo()

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await close_mongo_connection()

    app.include_router(auth_router)
    app.include_router(validation_router)
    app.include_router(registration_router)
    app.include_router(blueprint_router)
    app.include_router(simulation_router)
    app.include_router(scenario_intelligence_router)

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
