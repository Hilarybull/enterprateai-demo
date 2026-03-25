from __future__ import annotations

import logging
import sys


def configure_logging(environment: str) -> None:
    is_dev = environment == "development"
    level = logging.DEBUG if is_dev else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )

    # Keep third-party libraries from flooding logs in development.
    logging.getLogger("pymongo").setLevel(logging.WARNING)
    logging.getLogger("motor").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(level)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO if is_dev else logging.WARNING)
    logging.getLogger("app.http").setLevel(logging.INFO if is_dev else logging.WARNING)
