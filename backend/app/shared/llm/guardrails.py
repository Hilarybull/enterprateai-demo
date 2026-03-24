from __future__ import annotations

import re

_DIGITS_RE = re.compile(r"\d")
_DIGIT_GROUP_RE = re.compile(r"\d+")


def strip_numbers(text: str) -> str:
    """
    Enforce the "no digits" rule for AI-generated text.

    We replace digit groups with a readable placeholder instead of leaving the
    original digits in place. This avoids corrupt encoding artifacts and makes
    the output safe to show to end users.
    """
    return _DIGIT_GROUP_RE.sub("[num]", text)


def assert_no_numbers(text: str) -> None:
    if _DIGITS_RE.search(text):
        raise ValueError("LLM output contained digits; blocked to enforce no-calculation rule")

