"""The owner's copy rules for anything the owner reads (16 Oct): no em or en dashes."""
from __future__ import annotations

import re

_RANGE = re.compile(r"(\d)\s*[\u2013\u2014]\s*(\d)")
_DASH = re.compile(r"\s*[\u2013\u2014]\s*")


def no_dashes(text):
    """"15–20 interviews" reads "15 to 20 interviews"; a clause break becomes a comma. Anything else is left as it is."""
    if not isinstance(text, str) or ("\u2013" not in text and "\u2014" not in text):
        return text
    return _DASH.sub(", ", _RANGE.sub(r"\1 to \2", text))
