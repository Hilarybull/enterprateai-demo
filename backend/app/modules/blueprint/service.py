from __future__ import annotations

import asyncio
import re
from html import escape
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status

from app.modules.blueprint.repository import create_document, update_document
from app.modules.blueprint.schemas import (
    BlueprintDocumentUpdateRequest,
    BlueprintGenerateRequest,
    BlueprintGenerateResponse,
)
from app.modules.blueprint.templates import (
    BUSINESS_PLAN_TEMPLATE,
    CASHFLOW_ANALYSIS_TEMPLATE,
    CLIENT_PROPOSAL_TEMPLATE,
    FINANCIAL_PROJECTION_TEMPLATE,
    INVOICE_TEMPLATE,
    SALES_LETTER_TEMPLATE,
    SALES_QUOTATION_TEMPLATE,
    SYSTEM_POLICY,
    build_business_plan_prompt,
    build_client_proposal_prompt,
    build_sales_letter_prompt,
    format_inputs_for_prompt,
)
from app.modules.idea_validation.service import evaluate as evaluate_validation
from app.modules.idea_validation.service import get_workspace as get_validation_workspace
from app.modules.idea_validation.schemas import IdeaValidationPayload
from app.core.config import get_settings
from app.shared.llm.openai_client import AutoLLMClient, LLMClient, NoopLLMClient, pick_llm_for_user


def _safe_text(s: str | None) -> str:
    return (s or "").strip()

def _strip_digits(s: str | None) -> str:
    # Kept for backward compatibility in case older code paths call it.
    # We now allow numeric values that are explicitly provided by the system/user.
    return _safe_text(s)


def _today_string() -> str:
    now = datetime.now()
    return f"{now.day} {now.strftime('%B')} {now.year}"


def _expand_note(*, field: str, text: str, company: str, industry: str, target_market: str, pricing_model: str) -> str:
    """
    Deterministically expand very short user inputs into usable narrative notes.
    This is NOT an AI step; it exists to prevent "verbatim Q/A" looking documents
    when inputs are one-liners or when the LLM is unavailable.
    """
    t = _safe_text(text)

    c = company or "the business"
    i = industry or "the industry"
    tm = target_market or "the target customer"

    # If the user provided nothing, fall back to a general, non-claiming note that
    # still gives the generator enough context to produce usable prose.
    if not t:
        if field == "problem":
            return (
                f"In {i}, many {tm} struggle with inconsistency, unclear expectations, and the time cost of managing vendors. "
                f"When delivery is unpredictable, quality slips, issues take longer to resolve, and teams lose confidence in the provider.\n\n"
                f"{c} addresses this by defining a clear standard of service and removing uncertainty around what is delivered, when it is delivered, "
                f"and how quality is verified."
            )
        if field == "solution":
            return (
                f"{c} is built around a repeatable, standards-based process rather than ad-hoc effort. "
                f"Each engagement follows the same disciplined sequence so customers know what to expect and can rely on consistent outcomes.\n\n"
                f"Operationally, delivery is supported by checklists, quality assurance, and clear communication before and after service so issues are caught early "
                f"and resolved quickly."
            )
        if field == "value_proposition":
            return (
                f"{c} differentiates by reducing uncertainty for {tm}: clear standards, dependable delivery, and proactive communication. "
                f"The promise is simple â€” consistent results without extra oversight, and a service experience that is easy to buy, easy to deliver, and easy to measure."
            )
        if field == "hook":
            return (
                f"What if your next service decision removed the day-to-day hassle, without compromising standards? "
                f"{c} is designed for {tm} who value predictable outcomes, clear communication, and a provider they can rely on."
            )
        if field == "target_market":
            return (
                f"{tm} is the focus segment because reliability, speed of response, and consistency matter. "
                f"Messaging should emphasise clear standards, transparent expectations, and predictable delivery."
            )
        return ""

    # If user gave substantial content, keep it (but we still treat as notes).
    if len(t) >= 120:
        return t

    if field == "problem":
        return (
            f"{t.capitalize().rstrip('.')} is the surface symptom. Underneath, customers in {i} typically struggle with consistency, "
            f"trust, and the effort required to find a dependable provider. For {tm}, the cost of a poor experience is not only inconvenience "
            f"but also wasted time, rework, and the risk of disruptions.\n\n"
            f"{c} addresses this by defining a clear standard of service and reducing uncertainty: what is delivered, when it is delivered, and "
            f"how quality is verified."
        )

    if field == "solution":
        return (
            f"{t.capitalize().rstrip('.')} is delivered through a repeatable process, not ad-hoc effort. The offering is designed to be easy to buy, "
            f"easy to deliver, and easy to measure, so customers get predictable outcomes.\n\n"
            f"Operationally, {c} will rely on standard checklists, quality assurance, and clear communication before and after delivery to build trust and repeat usage."
        )

    if field == "target_market":
        return (
            f"{t} is the initial focus segment because it has a clear problem, a willingness to pay for reliability, and a strong need for predictable service. "
            f"{c} will start narrow to learn quickly, then expand to adjacent segments once the offer and delivery are proven.\n\n"
            f"Buying triggers are typically urgency, convenience, and trust. The messaging and channels will be shaped around those triggers."
        )

    if field == "value_proposition":
        return (
            f"{t.capitalize().rstrip('.')} is positioned as a measurable customer outcome rather than a slogan. {c} differentiates by reducing uncertainty: "
            f"clear standards, dependable scheduling, and fast resolution when issues occur.\n\n"
            f"The promise is simple: a consistent result, professional experience, and a provider customers can rely on without repeated supervision."
        )

    if field == "pricing_strategy":
        return (
            f"The pricing approach is {t.lower()} in structure, designed to be simple and aligned with customer value. Packaging will clarify what is included, "
            f"set expectations up-front, and make it easy for customers to choose the right option.\n\n"
            f"As the business validates demand, {c} will refine packaging and terms to improve repeat purchase and operational efficiency, while keeping pricing easy to understand."
        )

    if field == "mission":
        return (
            f"The mission is to deliver a reliable, high-quality service in {i}, with consistent standards and clear communication. "
            f"{c} exists to remove uncertainty for {tm} by making the experience predictable, professional, and easy to manage."
        )

    if field == "hook":
        return (
            f"{c} wins by making reliability the product: customers receive consistent outcomes, transparent expectations, and a service experience "
            f"that reduces hassle and builds trust over time. In a market where many providers feel interchangeable, {c} differentiates through process "
            f"discipline, responsiveness, and a clear standard of delivery."
        )

    if field == "channels":
        return (
            f"{t.capitalize().rstrip('.')} will be used as a primary route to market, chosen for speed of learning and clear conversion tracking. "
            f"{c} will prioritise channels that create trust early and produce repeatable demand.\n\n"
            f"Channel execution will include clear positioning, simple calls to action, and follow-up that reinforces credibility."
        )

    # Default: turn the fragment into a usable note.
    return (
        f"{t.capitalize().rstrip('.')} is treated as an initial assumption. {c} will validate it quickly and adjust based on customer feedback and delivery learnings."
    )


def _looks_like_clarification_or_refusal(text: str) -> bool:
    """
    Detects common "asking the user for more inputs" or refusal/meta responses that should never
    appear in generated blueprint content.
    """
    val = _safe_text(text).lower()
    if not val:
        return True

    needles = (
        "it looks like your message got cut off",
        "your message appears to be incomplete",
        "you didn't include",
        "could you please share",
        "please share the relevant inputs",
        "please provide the relevant business details",
        "once you provide those details",
        "i'm sorry, i'm not able",
        "i'm not able to",
        "i can't",
        "i cannot",
        "as an ai",
        "outside what i'm built",
        "falls outside what i'm built",
        "better results using",
        "you might find better results",
        "i'm designed specifically",
    )
    return any(n in val for n in needles)


def _sales_letter_benefits_fallback(*, company: str, target_market: str) -> str:
    c = company or "the business"
    tm = target_market or "your team"
    return "\n".join(
        [
            f"- Consistent outcomes your {tm} can rely on",
            "- Clear expectations before work begins, so delivery stays predictable",
            "- Quality checks that reduce rework and prevent issues from slipping through",
            "- Communication that keeps you informed without adding extra admin",
            f"- A service experience designed to be easy to buy, easy to deliver, and easy to measure with {c}",
        ]
    )


def _strip_md_noise_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out.append("")
            continue
        if stripped in {"---", "***"}:
            continue
        if re.match(r"^\s*#{1,6}\s+", stripped):
            continue
        out.append(line.rstrip())
    # collapse blank lines
    cleaned: list[str] = []
    for line in out:
        if not line.strip():
            if cleaned and cleaned[-1] == "":
                continue
            cleaned.append("")
        else:
            cleaned.append(line.strip())
    while cleaned and cleaned[0] == "":
        cleaned.pop(0)
    while cleaned and cleaned[-1] == "":
        cleaned.pop()
    return cleaned


def _strip_salutation_and_signoff(text: str) -> str:
    if not text:
        return text
    lines = text.splitlines()
    # Remove a leading "Dear ..." block if present.
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and re.match(r"^\s*dear\b", lines[i], re.IGNORECASE):
        i += 1
        while i < len(lines) and lines[i].strip():
            i += 1
        while i < len(lines) and not lines[i].strip():
            i += 1
        lines = lines[i:]

    # Remove common sign-off blocks at the end.
    signoff_idx = None
    for j, line in enumerate(lines):
        if re.match(r"^\s*(warm|kind|best)\s+regards\b", line, re.IGNORECASE):
            signoff_idx = j
            break
        if re.match(r"^\s*sincerely\b", line, re.IGNORECASE):
            signoff_idx = j
            break
    if signoff_idx is not None:
        lines = lines[:signoff_idx]

    return "\n".join(lines).strip()


def _first_sentence(text: str) -> str:
    val = _safe_text(text)
    if not val:
        return ""
    compact = re.sub(r"\s+", " ", val).strip()
    m = re.search(r"([.!?])\s", compact)
    if not m:
        return compact
    end = m.end(1)
    return compact[:end].strip()


def _clean_sales_letter_snippet(*, sid: str, text: str, company: str, client_name: str, target_market: str) -> str:
    raw = _safe_text(text)
    if not raw:
        return ""

    # Remove obvious meta/prefaces.
    raw = re.sub(r"^\s*here is (a|the)\b.*?\n+", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"^\s*sales letter\s*[:\u2014-].*?\n+", "", raw, flags=re.IGNORECASE)

    raw = _strip_salutation_and_signoff(raw)
    lines = _strip_md_noise_lines(raw.splitlines())
    cleaned = "\n".join(lines).strip()

    # Benefits should be bullets only.
    if sid == "benefits":
        bullet_lines = [l for l in cleaned.splitlines() if l.strip().startswith(("- ", "• "))]
        if bullet_lines:
            return _ensure_bullets("\n".join(bullet_lines))
        return _sales_letter_benefits_fallback(company=company, target_market=target_market)

    # Keep these as a single sentence.
    if sid in {"offer", "cta", "urgency"}:
        return _first_sentence(cleaned)

    return cleaned


def _clean_sales_letter_full_text(text: str) -> str:
    raw = _safe_text(text)
    if not raw:
        return ""

    # Remove obvious headings and separators the model sometimes injects.
    raw = re.sub(r"^\s*sales letter\s*[:\u2014-].*?$", "", raw, flags=re.IGNORECASE | re.MULTILINE)
    raw = raw.replace("\r\n", "\n")

    raw = _strip_salutation_and_signoff(raw)

    lines = _strip_md_noise_lines(raw.splitlines())
    label_only = {
        "headline",
        "opening / hook",
        "opening/hook",
        "hook",
        "problem statement",
        "solution introduction",
        "benefits",
        "proof / credibility",
        "offer",
        "call to action",
        "urgency / scarcity",
        "closing",
        "follow-up summary",
    }
    filtered: list[str] = []
    for line in lines:
        stripped = line.strip().strip(":").lower()
        if stripped in label_only:
            continue
        filtered.append(line)

    return "\n".join(filtered).strip()

def _clean_document(doc: str) -> str:
    """
    Light post-processing for readability:
    - collapse excessive blank lines
    - remove consecutive duplicate paragraphs
    - remove markdown horizontal rules
    - reduce excessive dash usage in prose
    """
    text = (doc or "").strip()
    # Remove markdown horizontal rules like "---" that often appear as visual separators.
    text = re.sub(r"(?m)^\s*([-*_])\1\1+\s*$\n?", "", text)
    # Replace em dashes with simple punctuation to avoid "dashy" documents.
    text = text.replace("—", ", ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    parts = [p.strip() for p in text.split("\n\n") if p.strip()]
    cleaned: list[str] = []
    last_norm = ""
    for p in parts:
        norm = re.sub(r"\s+", " ", p).strip().lower()
        if norm == last_norm:
            continue
        cleaned.append(p)
        last_norm = norm
    return "\n\n".join(cleaned)


def _render_template_with_fallback(template: str, raw: dict[str, Any]) -> str:
    enriched: dict[str, Any] = {}
    for k, v in raw.items():
        val = _safe_text(v)
        enriched[str(k)] = val if val else _narrative_fallback(str(k))
    for key in set(_TEMPLATE_FIELD_RE.findall(template)):
        if not str(enriched.get(key) or "").strip():
            enriched[key] = _narrative_fallback(key)
    return template.format(**enriched).strip()


def _strict_fallback_text(_: str | None = None) -> str:
    return "This section is based on available data provided by the business."


def _build_context_blurb(raw: dict[str, Any]) -> str:
    company = _safe_text(raw.get("company_name") or raw.get("company") or "")
    industry = _safe_text(raw.get("industry") or raw.get("primary_industry") or "")
    services = _safe_text(raw.get("solution") or raw.get("services") or "")
    target = _safe_text(raw.get("target_market") or raw.get("target_customer_type") or "")
    value_prop = _safe_text(raw.get("value_proposition") or raw.get("key_offering_focus") or raw.get("tagline") or "")
    problem = _safe_text(raw.get("problem") or "")
    objective = _safe_text(raw.get("objective") or "")

    parts: list[str] = []
    if company and industry:
        parts.append(f"{company} operates in {industry}.")
    elif company:
        parts.append(f"{company} is the business context for this section.")
    if services:
        parts.append(f"The core offer focuses on {services}.")
    if target:
        parts.append(f"Primary target market: {target}.")
    if value_prop:
        parts.append(f"Value proposition: {value_prop}.")
    if problem:
        parts.append(f"Key problem addressed: {problem}.")
    if objective:
        parts.append(f"Objective: {objective}.")

    if not parts:
        return _strict_fallback_text()
    return f"{_strict_fallback_text()} {' '.join(parts)}"


def _render_template_strict(template: str, raw: dict[str, Any], fallback_text: str | None = None) -> str:
    fallback = fallback_text or _strict_fallback_text()
    enriched: dict[str, Any] = {}
    for k, v in raw.items():
        val = _safe_text(v)
        enriched[str(k)] = val if val else fallback
    for key in set(_TEMPLATE_FIELD_RE.findall(template)):
        if not str(enriched.get(key) or "").strip():
            enriched[key] = fallback
    return template.format(**enriched).strip()


def _extract_section_map(doc: str) -> tuple[list[str], dict[str, str]]:
    lines = (doc or "").splitlines()
    preamble: list[str] = []
    sections: dict[str, str] = {}
    current_heading: str | None = None
    buffer: list[str] = []
    seen_heading = False

    def _canonical_heading(raw: str) -> str:
        line = (raw or "").strip()
        if line.startswith("## "):
            level = "##"
            text = line[3:].strip()
        elif line.startswith("### "):
            level = "###"
            text = line[4:].strip()
        else:
            return line
        # Tolerate numbering styles like "1. Executive Summary" or "1) Executive Summary".
        text = re.sub(r"^\s*\d+\s*[\.\)]\s*", "", text).strip()
        text = re.sub(r"^\s*\d+\s+", "", text).strip()
        return f"{level} {text}".strip()

    for line in lines:
        if line.startswith("## ") or line.startswith("### "):
            if current_heading is not None:
                sections[current_heading] = "\n".join(buffer).strip()
            current_heading = _canonical_heading(line)
            buffer = []
            seen_heading = True
            continue
        if not seen_heading:
            preamble.append(line)
        else:
            buffer.append(line)
    if current_heading is not None:
        sections[current_heading] = "\n".join(buffer).strip()
    return preamble, sections


def _rebuild_with_headings(
    *,
    preamble: list[str],
    headings: list[str],
    primary: dict[str, str],
    fallback: dict[str, str],
) -> str:
    out: list[str] = []
    pre = [l for l in preamble]
    while pre and not pre[-1].strip():
        pre.pop()
    if pre:
        out.extend(pre)
        out.append("")
    for heading in headings:
        out.append(heading)
        content = primary.get(heading) or fallback.get(heading) or ""
        if content:
            out.append(content)
        out.append("")
    return "\n".join(out).strip()


def _strip_business_plan_labels(doc: str) -> str:
    """
    Remove label-style prefixes that conflict with the business plan prompt
    (e.g., "The Mission:", "The Hook:", "The Request:").
    """
    if not doc:
        return doc
    patterns = (
        re.compile(r"^\s*The Mission:\s*", re.IGNORECASE),
        re.compile(r"^\s*The Hook:\s*", re.IGNORECASE),
        re.compile(r"^\s*The Request:\s*", re.IGNORECASE),
    )
    cleaned_lines: list[str] = []
    for line in doc.splitlines():
        updated = line
        for pat in patterns:
            updated = pat.sub("", updated)
        cleaned_lines.append(updated)
    return "\n".join(cleaned_lines).strip()


def _strip_financial_snapshot_section(doc: str) -> str:
    """
    Remove any FINANCIAL SNAPSHOT section from a business plan
    when snapshot is not explicitly requested.
    """
    if not doc:
        return doc
    lines = doc.splitlines()
    out: list[str] = []
    in_section = False
    for line in lines:
        if re.match(r"^\s*(##\s*)?FINANCIAL SNAPSHOT\b", line.strip(), re.IGNORECASE):
            in_section = True
            continue
        if in_section:
            if re.match(r"^\s*##\s+\S", line.strip()) or (
                re.match(r"^[A-Z][A-Z\s\-&/]+$", line.strip())
                and line.strip()
                and not line.strip().upper().startswith("FINANCIAL SNAPSHOT")
            ):
                in_section = False
                out.append(line)
            else:
                continue
        else:
            out.append(line)

    # Remove snapshot tables even if a heading is missing.
    cleaned: list[str] = []
    i = 0
    while i < len(out):
        line = out[i]
        if "|" in line:
            block: list[str] = []
            j = i
            while j < len(out) and ("|" in out[j] or not out[j].strip()):
                block.append(out[j])
                j += 1
            block_text = "\n".join(block).lower()
            if "monthly revenue" in block_text and "runway" in block_text and "metric" in block_text and "value" in block_text:
                i = j
                continue
            cleaned.extend(block)
            i = j
            continue
        cleaned.append(line)
        i += 1
    return "\n".join(cleaned).strip()


def _strip_cover_section(doc: str) -> str:
    lines = doc.splitlines()
    out: list[str] = []
    in_cover = False
    for i, line in enumerate(lines):
        if line.strip().lower() == "## cover page":
            in_cover = True
            continue
        if line.strip().lower() in {"cover page", "cover page:"}:
            continue
        if in_cover:
            if line.startswith("## "):
                in_cover = False
                out.append(line)
            else:
                continue
        else:
            out.append(line)
    return "\n".join(out).strip()


def _strip_preamble_before_first_h2(doc: str) -> str:
    if not doc:
        return doc
    lines = doc.splitlines()
    idx = next((i for i, l in enumerate(lines) if l.startswith("## ")), None)
    if idx is None:
        return doc.strip()
    return "\n".join(lines[idx:]).strip()


def _filter_to_wanted_headings(doc: str, wanted_headings: list[str]) -> str:
    if not doc:
        return doc
    wanted = [h for h in (wanted_headings or []) if isinstance(h, str) and h.startswith("## ")]
    if not wanted:
        return doc.strip()
    preamble, sections = _extract_section_map(doc)
    return _rebuild_with_headings(preamble=preamble, headings=wanted, primary=sections, fallback={}).strip()


def _normalize_sales_letter(
    doc: str,
    *,
    date_line: str | None,
    client_name: str | None,
    subject_line: str | None,
) -> str:
    if not doc:
        return doc
    lines = [l.rstrip() for l in doc.splitlines()]
    dear_idx = next((i for i, l in enumerate(lines) if re.match(r"^\s*dear\b", l, re.IGNORECASE)), None)
    if dear_idx is not None:
        body_lines = lines[dear_idx + 1:]
    else:
        body_lines = lines[:]

    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    while body_lines and (
        re.match(r"^\s*date\b", body_lines[0].strip(), re.IGNORECASE)
        or re.match(r"^\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}\s*$", body_lines[0].strip())
    ):
        body_lines.pop(0)
        while body_lines and not body_lines[0].strip():
            body_lines.pop(0)

    date_text = _safe_text(date_line)
    name = _safe_text(client_name) or "Client team"
    subject = _safe_text(subject_line) or _narrative_fallback("subject_line")
    subject_plain = subject.strip().lower()

    preamble: list[str] = []
    if date_text:
        preamble.append(date_text)
        preamble.append("")
    preamble.append(f"Dear {name},")
    preamble.append("")
    if subject:
        subject_text = subject.upper()
        preamble.append(f"<p class=\"subject-line\"><strong>{subject_text}</strong></p>")
        preamble.append("")

    filtered: list[str] = []
    non_empty_seen = 0
    for line in body_lines:
        stripped = line.strip()
        if not stripped:
            if filtered and filtered[-1] == "":
                continue
            filtered.append("")
            continue
        non_empty_seen += 1
        if re.match(r"^\s*to\s*:", stripped, re.IGNORECASE):
            continue
        if re.match(r"^\s*dear\b", stripped, re.IGNORECASE):
            continue
        if date_text and stripped.lower() == date_text.strip().lower():
            continue
        if "subject-line" in stripped.lower():
            continue
        if subject_plain and stripped.lower().strip("*") == subject_plain:
            continue
        if subject_plain and subject_plain in stripped.lower():
            continue
        if non_empty_seen <= 3 and stripped.startswith("**") and stripped.endswith("**"):
            # Remove stray bold headings at the top of the body.
            continue
        filtered.append(line)

    while filtered and not filtered[0].strip():
        filtered.pop(0)

    return "\n".join(preamble + filtered).strip()


def _strip_date_lines(doc: str) -> str:
    if not doc:
        return doc
    lines = doc.splitlines()
    cleaned: list[str] = []
    for idx, line in enumerate(lines):
        l = line.strip()
        if idx < 6:
            if re.match(r"^\s*date\b", l, re.IGNORECASE):
                continue
            if re.match(r"^\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}\s*$", l):
                continue
        cleaned.append(line)
    return "\n".join(cleaned).strip()


def _strip_contact_details_line(doc: str) -> str:
    if not doc:
        return doc
    cleaned = []
    for line in doc.splitlines():
        stripped = line.strip()
        if re.match(r"^\s*contact details\b", stripped, re.IGNORECASE):
            continue
        if re.search(r"contact\s+.*confirm details", stripped, re.IGNORECASE):
            continue
        cleaned.append(line)
    return "\n".join(cleaned).strip()


def _build_cover_page(title: str, lines: list[str], logo_data_url: str | None = None) -> str:
    clean_lines = [l for l in lines if isinstance(l, str) and l.strip()]
    logo_html = ""
    if _safe_text(logo_data_url):
        logo_html = f'<img class="document-logo" src="{escape(_safe_text(logo_data_url), quote=True)}" alt="Company logo" />\n\n'
    body = "\n".join(clean_lines)
    return f"<div class=\"cover-page\">\n{logo_html}# {title}\n\n{body}\n</div>\n\n<div class=\"page-break\"></div>"


def _strip_duplicate_title_after_cover(doc: str, title: str) -> str:
    if not doc:
        return doc
    lines = doc.splitlines()
    title_variants = {
        title.strip().lower(),
        f"# {title}".strip().lower(),
        "cover page",
        "cover page:",
    }
    idx = 0
    while idx < len(lines) and not lines[idx].strip():
        idx += 1
    while idx < len(lines):
        stripped = lines[idx].strip()
        if not stripped:
            idx += 1
            continue
        lower = stripped.lower()
        if lower in title_variants:
            idx += 1
            continue
        if re.match(r"^\*+.*\*+$", stripped) and stripped.strip("* ").lower() == title.strip().lower():
            idx += 1
            continue
        break
    return "\n".join(lines[idx:]).strip()


def _apply_cover_page(doc: str, *, title: str, lines: list[str], logo_data_url: str | None = None) -> str:
    cleaned = _strip_cover_section(doc)
    cleaned = _strip_duplicate_title_after_cover(cleaned, title)
    cover = _build_cover_page(title, lines, logo_data_url=logo_data_url)
    return f"{cover}\n\n{cleaned}".strip()


def _ensure_client_proposal_format(doc: str) -> str:
    """
    Enforce presentation rules for client proposals:
    - Insert a page break after the Cover Page section.
    - Ensure Implementation Plan / Timeline is a pipe table.
    """
    if not doc:
        return doc

    lines = doc.splitlines()

    # Insert page break after cover page block
    cover_idx = next((i for i, l in enumerate(lines) if l.strip() == "## Cover Page"), None)
    exec_idx = next((i for i, l in enumerate(lines) if l.strip() == "## Executive Summary"), None)
    if cover_idx is not None and exec_idx is not None:
        # check if a page break already exists between cover and executive summary
        has_break = any("page-break" in l for l in lines[cover_idx:exec_idx])
        if not has_break:
            lines.insert(exec_idx, "<div class=\"page-break\"></div>")
            lines.insert(exec_idx, "")

    return "\n".join(lines)


def _normalize_client_proposal_cover_page(
    doc: str,
    *,
    proposal_title: str,
    company_name: str,
    client_name: str,
    contact_details: str,
    selected_services_focus: str,
    logo_data_url: str | None = None,
) -> str:
    if not doc:
        return doc

    def _display_name(value: str) -> str:
        val = _safe_text(value)
        if not val:
            return ""
        if "@" in val:
            return val
        if val == val.lower() or val == val.upper():
            return val.title()
        return val

    display_client = _display_name(client_name) or "Client"

    def _format_service_focus(raw: str) -> str:
        text = _safe_text(raw)
        if not text:
            return ""
        first = text.splitlines()[0].strip()
        parts = [p.strip() for p in first.split(" - ") if p.strip()]
        name = parts[0] if parts else first
        cat = parts[1] if len(parts) > 1 else ""
        if cat:
            return f"{name} ({cat.title()})"
        return name

    cover_lines: list[str] = []
    cover_lines.append(f"**Prepared by:** {_display_name(company_name) or _safe_text(company_name) or 'Prepared by'}")
    cover_lines.append(f"**Prepared for:** {display_client}")
    focus = _format_service_focus(selected_services_focus)
    if focus:
        cover_lines.append(f"**Service focus:** {focus}")
    if _safe_text(contact_details):
        cover_lines.append(f"**Contact:** {_safe_text(contact_details)}")

    cleaned = _strip_preamble_before_first_h2(doc)
    cleaned = _strip_cover_section(cleaned)
    return _apply_cover_page(
        cleaned,
        title=f"Proposal for {display_client}",
        lines=cover_lines,
        logo_data_url=logo_data_url,
    )


def _narrative_fallback(title: str) -> str:
    if title in ("date",):
        return _today_string()
    if title in ("letter_date",):
        return _today_string()
    if title in ("subject_line",):
        return "A reliable, no-drama way to keep standards consistent"
    if title in ("headline",):
        return "Reliable service that keeps your operation running smoothly without extra oversight."
    if title in ("cta",):
        return "Reply to this message to arrange a short call and confirm fit for your requirements."
    if title in ("urgency",):
        return "We keep onboarding slots limited to protect delivery standards, so early confirmation helps us reserve the right capacity."
    if title in ("proof",):
        return (
            "We deliver through documented standards, quality checks, and clear communication at every step. "
            "That approach reduces risk for the client and creates consistent outcomes they can rely on."
        )
    if title in ("offer",):
        return "A clearly defined service with predictable delivery, transparent scope, and a reliable point of contact."
    if title in ("closing",):
        return "If this matches the level of reliability you want, we would be glad to walk you through the next steps."
    if title in ("bill_to",):
        return "Client details supplied in your onboarding or purchase order."
    if title in ("items", "items_table"):
        return "Service delivery aligned to the agreed scope and standards."
    if title in ("scope_summary",):
        return "Defined delivery scope with clear inclusions, service standards, and communication cadence."
    if title in ("terms",):
        return "Standard business terms apply, with clear cancellation and change procedures."
    if title in ("notes",):
        return "Thank you for your business. We are committed to a smooth, reliable delivery."
    if title in ("target_audience",):
        return "Operations and facilities decision‑makers in the target segment."
    if title in ("name",):
        return "Client Services Team"
    if title in ("position",):
        return "Client Services"
    if title in ("phone",):
        return "Phone: available on request"
    if title in ("email",):
        return "Email: available on request"
    if title in ("website",):
        return "Website: available on request"
    if title == "overview":
        return (
            "This plan outlines what the business does, the customer problem it solves, and the practical steps required to launch and grow. "
            "It is written as an execution guide, so each section can be used to make decisions, assign ownership, and track progress.\n\n"
            "The immediate focus is validation and repeatable delivery: proving demand with real customers, tightening the offer, and building the operating "
            "muscle to deliver consistently. Once that baseline is established, the plan shifts to scaling through better packaging, stronger channels, and a "
            "repeatable service standard."
        )
    if title == "business_overview":
        return (
            "The business is designed to operate with clear standards, consistent delivery, and a customer experience that encourages repeat purchase. "
            "Day-to-day execution is supported by a simple operating rhythm: intake and booking, service delivery, quality assurance, and structured follow-up.\n\n"
            "From the start, the business will document its delivery process and treat quality as a system rather than an individual effort. This makes it easier "
            "to train staff or contractors, maintain consistency, and scale without damaging customer trust."
        )
    if title == "mission":
        return (
            "The mission is to deliver a reliable, high-quality service that customers can trust, with consistent standards and clear communication. "
            "The business will focus on repeatable delivery, a strong customer experience, and sustainable growth through operational discipline.\n\n"
            "In practice, that means:\n"
            "- Building clear service standards customers can understand\n"
            "- Delivering consistently through checklists and quality checks\n"
            "- Earning repeat purchase through trust, responsiveness, and professionalism"
        )
    if title == "hook":
        return (
            "The core value proposition is quality and reliability: customers receive a consistent outcome, predictable service, and a straightforward experience. "
            "The offer is positioned for busy customers who value trust, speed, and clarity over complexity."
        )
    if title == "business_model":
        return (
            "Revenue is generated through clearly packaged services with defined inclusions and a straightforward pricing approach. "
            "The model prioritises repeatable delivery and customer retention over one-off transactions."
        )
    if title == "risk_market":
        return (
            "Market risk centres on slower adoption or lower willingness to switch providers. Mitigation focuses on clear differentiation, "
            "early validation with target customers, and a strong proof of reliability."
        )
    if title == "risk_financial":
        return (
            "Financial risk relates to cash flow timing and cost control. Mitigation includes conservative ramp-up assumptions, tight cost discipline, "
            "and staged investment aligned to validated demand."
        )
    if title == "risk_operational":
        return (
            "Operational risk involves delivery consistency and staffing capacity. Mitigation includes documented standards, quality checks, "
            "and a phased hiring approach that matches demand."
        )
    if title == "risk_regulatory":
        return (
            "Regulatory risk is managed by staying aligned with UK compliance requirements, maintaining proper documentation, "
            "and reviewing obligations as the business scales."
        )
    if title == "funding_request":
        return (
            "The business is seeking appropriate start-up funding to cover early operating costs, initial marketing, and essential tools and systems. "
            "Funding will be used to accelerate validation, reach early customers, and establish repeatable delivery before scaling."
        )
    if title == "legal_structure":
        return (
            "A legal structure with limited liability is recommended to separate personal and business risk and to support future hiring and contracting. "
            "The chosen structure should also support clear ownership, taxation, and credibility with customers and partners."
        )
    if title == "registration":
        return (
            "Registration readiness includes confirming the company name, selecting appropriate industry codes, and preparing director and address details. "
            "The business will complete registration through the official authority and keep a record of confirmation details for compliance."
        )
    if title == "location":
        return (
            "The operating location will be selected based on customer density, ease of service delivery, and access to talent and partners. "
            "The plan assumes a localised initial launch before expansion to adjacent areas once delivery is repeatable."
        )
    if title in ("target_market", "target_audience"):
        return (
            "The target market is a clearly defined segment with an urgent need, a willingness to pay, and repeat purchase potential. "
            "The initial focus will be narrow to speed up validation, then expanded as product-market fit becomes clearer."
        )
    if title in ("market", "market_trends"):
        return (
            "The market is driven by demand for convenience, trustworthy providers, and services that save customers time and reduce hassle. Customers increasingly "
            "expect clear standards, predictable scheduling, and fast resolution when something goes wrong.\n\n"
            "The plan is to compete on reliability rather than being the cheapest option. Differentiation is achieved through consistent delivery, clear service "
            "inclusions, proactive communication, and an experience designed for repeat use."
        )
    if title in ("competitor_analysis",):
        return (
            "Competitors typically include local providers, independent operators, and larger platforms or marketplaces. Many alternatives compete on price but fail "
            "on consistency, communication, and predictable outcomes.\n\n"
            "This business differentiates through:\n"
            "- Clear standards and service definitions (what is included and what is not)\n"
            "- Dependable scheduling with confirmations and reminders\n"
            "- Quality control and a feedback loop that improves outcomes over time"
        )
    if title in ("problem", "problem_statement", "client_situation", "pain_points"):
        return (
            "Customers experience inconsistency, poor communication, or unreliable delivery from existing options, creating risk and frustration. "
            "The problem is acute for customers who value predictability and want a provider they can trust without repeated oversight."
        )
    if title in ("solution", "approach", "solution_introduction"):
        return (
            "The solution is a service with clear standards, simple booking, and dependable fulfilment. "
            "Delivery is supported by checklists, quality assurance, and a feedback loop that improves outcomes over time."
        )
    if title in ("value_proposition", "benefits", "business_impact"):
        return (
            "- Consistent delivery that reduces rework and disruption\n"
            "- Clear expectations and communication for smoother coordination\n"
            "- A reliable outcome that protects internal standards and reputation"
        )
    if title in ("pricing_strategy", "commercial_terms"):
        return (
            "Pricing is designed to be simple and aligned with customer value, with clear inclusions and transparent terms. "
            "The business will test packaging and pricing during validation, then standardise once repeatable demand is confirmed."
        )
    if title in ("branding",):
        return (
            "Branding emphasises trust, professionalism, and clarity. "
            "The brand voice is direct and reassuring, with visual identity designed to signal reliability and quality."
        )
    if title in ("channels", "go_to_market"):
        return (
            "The initial go-to-market focuses on a small number of channels that can reliably produce early demand and fast learning. Channels are prioritised based "
            "on speed to iterate, low acquisition complexity, and clear conversion tracking.\n\n"
            "A practical starting mix includes:\n"
            "- Referrals and local partnerships to build trust quickly\n"
            "- Search and local listings where customers show high intent\n"
            "- Targeted outbound to a narrow segment where the pain is clear"
        )
    if title in ("suppliers",):
        return (
            "Key suppliers will be selected for reliability, consistent quality, and predictable availability. "
            "The business will standardise inputs to reduce variability and protect service quality."
        )
    if title in ("technology",):
        return (
            "Core systems include customer communication, scheduling, record-keeping, and basic reporting. "
            "Technology choices prioritise simplicity and reliability, with room to scale as volume increases."
        )
    if title in ("insurance",):
        return (
            "Appropriate business insurance is required to protect against operational risk and to meet customer expectations. "
            "Coverage should be reviewed as the business expands into new services or hires staff."
        )
    if title in ("operations",):
        return (
            "Operations will be driven by standard operating procedures, checklists, and quality control. The goal is consistent delivery with measurable standards, "
            "fast issue resolution, and continuous improvement.\n\n"
            "Operational priorities:\n"
            "- Standardise delivery so quality does not depend on a single person\n"
            "- Build a simple system for scheduling, customer communication, and follow-up\n"
            "- Capture feedback and turn it into training and process improvements"
        )
    if title in ("team",):
        return (
            "The initial team is lean, with clear responsibility for sales, delivery, and customer success. Roles are designed around execution rather than hierarchy, "
            "so decisions can be made quickly during validation.\n\n"
            "As demand grows, the business will add delivery capacity and introduce quality assurance to maintain standards, along with light operations support to keep "
            "scheduling and communication smooth."
        )
    if title in ("hiring_plan",):
        return (
            "Hiring will follow demand and is focused on roles that directly increase delivery capacity or improve customer outcomes. "
            "The business will prioritise training, consistency, and a culture of accountability to protect service quality."
        )
    if title in ("sales_forecast", "cashflow_summary", "breakeven"):
        return (
            "Financial planning is expressed as a narrative: the business aims to reach repeatable demand, improve unit economics through better packaging, and "
            "maintain disciplined cost control. Break-even is expected once recurring demand and operational efficiency are stabilised."
        )
    if title in ("risks",):
        return (
            "Key risks include weak demand validation, operational inconsistency, and customer acquisition cost uncertainty. There is also reputational risk early on "
            "if delivery is inconsistent.\n\n"
            "Mitigations include tight validation loops, standardised delivery processes, and a channel strategy focused on measurable learning. The business should "
            "start narrow, deliver extremely well, and only expand once repeat demand and stable operations are proven."
        )
    if title in ("milestones", "product_roadmap"):
        return (
            "Milestones focus on validation, initial launch, repeat purchase behaviour, and operational readiness for scaling. "
            "The roadmap prioritises improvements that increase customer satisfaction, reduce delivery variability, and strengthen repeat demand."
        )
    if title in ("market_expansion", "partnerships", "technology_adoption", "operational_expansion"):
        return (
            "Growth is planned through controlled expansion: deepen performance in the initial segment, then broaden geography or adjacent segments. "
            "Partnerships and tooling are introduced when they reduce acquisition cost or improve delivery reliability."
        )
    if title in ("conclusion", "next_steps"):
        return (
            "The business is positioned to validate quickly, deliver consistently, and scale responsibly. Success depends on narrowing the initial segment, validating "
            "real demand, and building delivery standards that customers can rely on.\n\n"
            "Immediate next steps are to run a focused pilot, capture customer feedback, refine packaging and pricing, and formalise the operating process so the model "
            "can scale without quality dropping."
        )

    # Generic, but still useful.
    return (
        "The content here should reinforce reliable delivery, clear scope, and outcomes the client can trust. "
        "It should read as confident guidance rather than a placeholder."
    )


def _sentence_case(text: str) -> str:
    val = _safe_text(text)
    if not val:
        return ""
    return val[0].upper() + val[1:]


def _ensure_bullets(text: str) -> str:
    val = _safe_text(text)
    if not val:
        return ""
    lines = [l.strip() for l in val.splitlines() if l.strip()]
    if not lines:
        return ""
    if any(l.startswith("- ") or l.startswith("• ") for l in lines):
        return "\n".join(lines)
    return "\n".join(f"- {l}" for l in lines)


def _quote_items_table(items: str, scope_hint: str) -> str:
    text = _safe_text(items)
    scope = _safe_text(scope_hint) or "Service delivery aligned to agreed standards"
    if text and "|" in text:
        return text
    lines = [l.strip("-• ").strip() for l in text.splitlines() if l.strip()] if text else []
    if not lines:
        return f"| {scope} | {scope} | As agreed | Delivered to agreed standard |"
    return "\n".join(
        f"| {line} | {scope} | As agreed | Delivered to agreed standard |" for line in lines
    )


def _invoice_items_table(items: str, scope_hint: str) -> str:
    text = _safe_text(items)
    scope = _safe_text(scope_hint) or "Service delivery aligned to agreed standards"
    if text and "|" in text:
        return text
    lines = [l.strip("-• ").strip() for l in text.splitlines() if l.strip()] if text else []
    if not lines:
        return f"| {scope} | {scope} | As agreed |"
    return "\n".join(
        f"| {line} | {scope} | As agreed |" for line in lines
    )


def _inject_signature_block(doc: str, lines: list[str]) -> str:
    cleaned = [l for l in (lines or []) if _safe_text(l)]
    if not cleaned:
        return doc
    def _strip_existing_signoff(text: str) -> str:
        signoffs = (
            "yours sincerely",
            "yours faithfully",
            "sincerely",
            "best regards",
            "kind regards",
            "regards",
        )
        lines = text.splitlines()
        for i, line in enumerate(lines):
            l = line.strip().lower()
            if any(l.startswith(s) for s in signoffs):
                return "\n".join(lines[:i]).rstrip()
        return text.rstrip()

    base = _strip_existing_signoff(doc)
    block = "Yours sincerely,\n" + "\n".join(cleaned)
    return base.rstrip() + "\n\n" + block


_TEMPLATE_FIELD_RE = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)}")

BUSINESS_PLAN_HEADINGS = [
    "## Executive Summary",
    "## Business Overview",
    "## Products and Services",
    "## Market Analysis",
    "## Competitive Analysis",
    "## Business Model",
    "## Marketing and Sales Strategy",
    "## Operations Plan",
    "## Management and Organisation",
    "## Financial Snapshot",
    "## Funding Requirements",
    "## Risk Analysis and Mitigation",
    "## Conclusion",
]

CLIENT_PROPOSAL_HEADINGS = [
    "## Cover Page",
    "## Executive Summary",
    "## Client Needs / Problem Statement",
    "## Proposed Solution",
    "## Scope of Work",
    "## Methodology / Approach",
    "## Timeline / Delivery Schedule",
    "## Pricing and Payment Terms",
    "## Value Proposition / Benefits",
    "## Company Profile",
    "## Terms and Conditions",
    "## Acceptance / Next Steps",
]


async def _generate_section(
    llm: LLMClient,
    *,
    prompt: str,
    label: str,
    warnings: list[str],
    feature: str | None = None,
) -> tuple[str, str, str]:
    try:
        res = await llm.generate_text(system=SYSTEM_POLICY, prompt=prompt, feature=feature or f"blueprint.{label}")
        text = res.text.strip()
        if not text:
            warnings.append(f"AI returned empty text for: {label}")
        return text, res.provider, res.model
    except Exception as e:
        detail = str(e).strip() or "Unknown error"
        warnings.append(f"AI generation failed for {label}: {type(e).__name__}: {detail}")
        return "", "noop", "none"


async def _generate_section_required(
    llm: LLMClient,
    *,
    prompt: str,
    label: str,
    warnings: list[str],
    error_label: str,
    feature: str | None = None,
) -> tuple[str, str, str]:
    text, provider, model = await _generate_section(llm, prompt=prompt, label=label, warnings=warnings, feature=feature)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI generation failed for {error_label}. Check provider credentials and try again.",
        )
    return text, provider, model


def _format_section_prompt(*, doc_type: str, section_title: str, inputs_text: str, target_words: int) -> str:
    return (
        f"Write only the section body for '{section_title}' in a {doc_type}.\n"
        "Requirements (strict):\n"
        "- UK professional English.\n"
        f"- Target length: about {int(target_words)} words (adjust to data depth; do not pad with fluff).\n"
        "- Write in complete prose paragraphs. Bullet points are allowed sparingly, but do not overuse them.\n"
        "- No headings (no '##' or '###'), labels, or numbering in the output.\n"
        "- Use ONLY the provided inputs as factual claims. Do not invent, assume, estimate, or infer specific facts.\n"
        "- If a detail is missing, write generically without adding facts (use careful language such as 'based on available information').\n"
        "- No invented prices, dates, or numeric claims.\n"
        "- Avoid repetition and keep it specific to the inputs.\n\n"
        f"INPUTS:\n{inputs_text}"
    )


async def _ensure_section_bodies(
    llm: LLMClient,
    *,
    doc_type: str,
    wanted_headings: list[str],
    raw_inputs: dict[str, Any],
    doc: str,
    warnings: list[str],
    target_words: int,
) -> str:
    """
    Ensure all requested H2 sections exist and are substantive.
    Generates all missing/thin sections in parallel for speed.
    """
    inputs_text = format_inputs_for_prompt(raw_inputs)
    preamble, section_map = _extract_section_map(doc)

    # Find all sections that need generation
    missing = []
    for heading in wanted_headings:
        body = (section_map.get(heading) or "").strip()
        if len(body.split()) >= 160:
            continue
        title = heading.replace("## ", "").strip()
        prompt = _format_section_prompt(
            doc_type=doc_type,
            section_title=title,
            inputs_text=inputs_text,
            target_words=target_words,
        )
        missing.append((heading, title, prompt))

    if missing:
        async def gen_one(heading: str, title: str, prompt: str):
            text, _, _ = await _generate_section_required(
                llm,
                prompt=prompt,
                label=f"{doc_type}_{title}",
                warnings=warnings,
                error_label=f"{doc_type} section '{title}'",
                feature=f"blueprint.{doc_type.lower().replace(' ', '_')}.section",
            )
            return heading, text.strip()

        results = await asyncio.gather(
            *[gen_one(h, t, p) for h, t, p in missing],
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                continue  # warning already added in _generate_section_required
            heading, text = result
            section_map[heading] = text

    return _rebuild_with_headings(preamble=preamble, headings=wanted_headings, primary=section_map, fallback={})


async def _generate_sections_fallback(
    llm: LLMClient,
    *,
    doc_type: str,
    headings: list[str],
    inputs_text: str,
    warnings: list[str],
    cover_lines: list[str] | None = None,
    fallback_text: str | None = None,
) -> tuple[str, str, str]:
    provider = "mixed"
    model = "mixed"
    out: list[str] = []
    for heading in headings:
        title = heading.replace("## ", "").replace("### ", "").strip()
        if heading == "## Cover Page" and cover_lines:
            cover = "\n".join([l for l in cover_lines if _safe_text(l)])
            out.append(heading)
            out.append(cover if cover.strip() else "Cover page details are provided below.")
            out.append('<div class="page-break"></div>')
            out.append("")
            continue
        prompt = _format_section_prompt(
            doc_type=doc_type,
            section_title=title,
            inputs_text=inputs_text,
            target_words=450,
        )
        text, provider, model = await _generate_section(
            llm,
            prompt=prompt,
            label=f"{doc_type}_{title}",
            warnings=warnings,
        )
        if not text:
            text = fallback_text or _narrative_fallback(title.lower().replace(" ", "_"))
        out.append(heading)
        out.append(text)
        out.append("")
    return "\n".join(out).strip(), provider, model


def _fmt_money(amount: float, currency: str) -> str:
    cur = (currency or "USD").upper()
    try:
        val = float(amount)
    except Exception:
        val = 0.0
    return f"{cur} {val:,.2f}"


def _fmt_pct(ratio: float) -> str:
    try:
        val = float(ratio)
    except Exception:
        val = 0.0
    return f"{val * 100.0:.1f}%"


def _fmt_months(val: Any) -> str:
    if val is None:
        return "Infinity"
    try:
        n = float(val)
    except Exception:
        return "—"
    if n < 0:
        n = 0.0
    return f"{n:.2f} months"


def _extract_currency_from_workspace_data(data: dict) -> str | None:
    iv = data.get("idea_validation")
    if isinstance(iv, dict):
        bc = iv.get("context")
        if isinstance(bc, dict):
            cur = bc.get("currency")
            if isinstance(cur, str) and cur.strip():
                return cur.strip().upper()
    bc = data.get("business_context")
    if isinstance(bc, dict):
        cur = bc.get("currency")
        if isinstance(cur, str) and cur.strip():
            return cur.strip().upper()
    profile = data.get("business_profile")
    if isinstance(profile, dict):
        cur = profile.get("currency")
        if isinstance(cur, str) and cur.strip():
            return cur.strip().upper()
    return None


def _extract_business_context_from_workspace(data: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    iv = data.get("idea_validation")
    if isinstance(iv, dict):
        bc = iv.get("context")
        if isinstance(bc, dict):
            out["location"]         = _safe_text(bc.get("location") if isinstance(bc.get("location"), str) else "")
            out["industry"]         = _safe_text(bc.get("business_type") if isinstance(bc.get("business_type"), str) else "")
            out["primary_industry"] = _safe_text(bc.get("primary_industry") if isinstance(bc.get("primary_industry"), str) else "")
        problem = iv.get("problem")
        if isinstance(problem, dict):
            out["target_market"] = _safe_text(problem.get("customer_segment") if isinstance(problem.get("customer_segment"), str) else "")
            out["problem"] = _safe_text(problem.get("problem_type") if isinstance(problem.get("problem_type"), str) else "")
        offer = iv.get("offer")
        if isinstance(offer, dict):
            out["solution"] = _safe_text(offer.get("service_type") if isinstance(offer.get("service_type"), str) else "")
        # allow optional value proposition from extra context if present
        if isinstance(bc, dict):
            out["value_proposition"] = _safe_text(bc.get("value_proposition") if isinstance(bc.get("value_proposition"), str) else "")
    bc2 = data.get("business_context")
    if isinstance(bc2, dict):
        out.setdefault("location",         _safe_text(bc2.get("location") if isinstance(bc2.get("location"), str) else ""))
        out.setdefault("industry",         _safe_text(bc2.get("business_type") if isinstance(bc2.get("business_type"), str) else ""))
        out.setdefault("primary_industry", _safe_text(bc2.get("primary_industry") if isinstance(bc2.get("primary_industry"), str) else ""))
    profile = data.get("business_profile")
    if isinstance(profile, dict):
        out.setdefault("location",         _safe_text(profile.get("location") if isinstance(profile.get("location"), str) else ""))
        out.setdefault("industry",         _safe_text(profile.get("business_type") if isinstance(profile.get("business_type"), str) else ""))
        out.setdefault("primary_industry", _safe_text(profile.get("primary_industry") if isinstance(profile.get("primary_industry"), str) else ""))
        out.setdefault("value_proposition", _safe_text(profile.get("value_proposition") if isinstance(profile.get("value_proposition"), str) else ""))
    return {k: v for k, v in out.items() if isinstance(v, str) and v.strip()}


def _validation_from_workspace_financials(data: dict) -> dict | None:
    financials = data.get("financials")
    if not isinstance(financials, dict):
        return None
    invoices = financials.get("invoices") or []
    expenses = financials.get("expenses") or []
    contracts = financials.get("contracts") or []
    if not (isinstance(invoices, list) or isinstance(expenses, list) or isinstance(contracts, list)):
        return None
    has_any_entries = bool(invoices) or bool(expenses) or bool(contracts)
    if not has_any_entries:
        return None

    def sum_by(items, key, *, status_key=None, status_value=None):
        total = 0.0
        for item in items if isinstance(items, list) else []:
            if status_key and status_value is not None and item.get(status_key) != status_value:
                continue
            try:
                total += float(item.get(key) or 0.0)
            except Exception:
                continue
        return total

    paid_invoices = sum_by(invoices, "total_amount", status_key="status", status_value="paid")
    paid_expenses = sum_by(expenses, "price", status_key="status", status_value="paid")
    signed_contracts = [c for c in contracts if isinstance(c, dict) and c.get("status") == "signed"]
    sales_contracts = sum_by([c for c in signed_contracts if c.get("contract_type") != "purchase"], "price")
    purchase_contracts = sum_by([c for c in signed_contracts if c.get("contract_type") == "purchase"], "price")

    revenue = paid_invoices + sales_contracts
    costs = paid_expenses + purchase_contracts
    net = revenue - costs
    margin = (net / revenue) if revenue > 0 else 0.0

    return {
        "metrics": {
            "revenue_monthly": revenue,
            "costs_monthly": costs,
            "net_monthly": net,
            "margin": margin,
            "break_even_months": None,
            "runway_months": None,
        }
    }


def _render_validation_snapshot(*, currency: str, validation: dict | None) -> str:
    if not validation:
        return (
            "Not available yet. Add financial inputs in your workspace to generate this snapshot."
        )
    metrics  = validation.get("metrics") if isinstance(validation.get("metrics"), dict) else {}
    catalogue = validation.get("catalogue") if isinstance(validation.get("catalogue"), dict) else {}
    revenue    = metrics.get("revenue_monthly", 0.0)
    costs      = metrics.get("costs_monthly", 0.0)
    net        = metrics.get("net_monthly", 0.0)
    margin     = metrics.get("margin", 0.0)
    break_even = metrics.get("break_even_months")
    runway     = metrics.get("runway_months")

    rows = [
        ("Monthly revenue", _fmt_money(float(revenue or 0.0), currency)),
        ("Monthly costs", _fmt_money(float(costs or 0.0), currency)),
        ("Monthly net", _fmt_money(float(net or 0.0), currency)),
        ("Contribution margin", _fmt_pct(float(margin or 0.0))),
        ("Break-even", _fmt_months(break_even)),
        ("Runway", _fmt_months(runway)),
    ]
    return "\n".join([f"- {label}: {value}" for label, value in rows]).strip()


def _render_cashflow_analysis_fields(*, company: str, currency: str, validation: dict | None, starting_cash: float) -> dict[str, str]:
    metrics = validation.get("metrics") if isinstance(validation, dict) and isinstance(validation.get("metrics"), dict) else {}
    revenue = float(metrics.get("revenue_monthly") or 0.0)
    costs   = float(metrics.get("costs_monthly") or 0.0)
    net     = float(metrics.get("net_monthly") or 0.0)
    opening = float(starting_cash or 0.0)
    closing = opening + net

    def money(x: float) -> str:
        return _fmt_money(x, currency)

    forecast_table = _render_cashflow_12m_table(
        currency=currency, monthly_revenue=revenue, monthly_costs=costs, starting_cash=opening
    )
    assumptions = "\n".join([
        "- Revenue and costs are held constant at the baseline monthly assumptions from your workspace inputs.",
        "- Starting cash is taken from your workspace (or defaults to zero if not provided).",
        "- Update your financial inputs to regenerate an updated cash flow view.",
    ])
    insights = []
    if revenue <= 0 and costs <= 0:
        insights.append("- Add revenue and cost assumptions to make the cash flow analysis meaningful.")
    elif net >= 0:
        insights.append("- Your baseline assumptions indicate positive monthly cash flow.")
        insights.append("- Use the forecast table to validate how quickly cash accumulates under the same assumptions.")
    else:
        insights.append("- Your baseline assumptions indicate negative monthly cash flow.")
        insights.append("- Consider improving pricing, reducing costs, or validating demand to strengthen cash position.")
    insights_text = "\n".join(insights) if insights else "Summary insights based on the baseline view."

    return {
        "report_type":           "Baseline cash flow analysis",
        "period":                "Monthly baseline (current assumptions)",
        "opening_balance":       money(opening),
        "net_cashflow":          money(net),
        "closing_balance":       money(closing),
        "sales_receipts_note":   "Based on your current revenue inputs.",
        "sales_receipts_value":  money(revenue),
        "other_income":          "No other income assumed unless added to your inputs.",
        "other_income_value":    money(0.0),
        "total_inflows":         money(revenue),
        "operating_expenses_note": "Modelled from your baseline monthly costs.",
        "operating_expenses_value": money(costs),
        "cogs":                  "Included within baseline costs unless separated.",
        "cogs_value":            money(0.0),
        "capex":                 "No capital expenditure assumed in this baseline view.",
        "capex_value":           money(0.0),
        "financial_obligations": "No financing obligations assumed unless captured in inputs.",
        "financial_obligations_value": money(0.0),
        "total_outflows":        money(costs),
        "forecast":              forecast_table,
        "assumptions":           assumptions,
        "best_case":             "Stronger demand and improved pricing discipline, while maintaining cost control.",
        "expected_case":         "Current baseline assumptions hold and cash position evolves as projected.",
        "worst_case":            "Slower demand, higher costs, and longer time‑to‑collect cash from customers.",
        "insights":              insights_text,
    }


def _extract_starting_cash_from_workspace(data: dict) -> float:
    iv = data.get("idea_validation")
    if not isinstance(iv, dict):
        return 0.0
    try:
        payload = IdeaValidationPayload(**iv)
    except Exception:
        return 0.0
    if not payload.cash:
        return 0.0
    return float(payload.cash.starting_cash or 0.0)


def _render_cashflow_12m_table(*, currency: str, monthly_revenue: float, monthly_costs: float, starting_cash: float) -> str:
    rev  = float(monthly_revenue or 0.0)
    costs = float(monthly_costs or 0.0)
    cash = float(starting_cash or 0.0)
    net  = rev - costs
    lines: list[str] = []
    lines.append("| Month | Revenue | Costs | Net | Ending Cash |")
    lines.append("|---:|---:|---:|---:|---:|")
    for m in range(1, 13):
        cash += net
        lines.append(
            f"| {m} | {_fmt_money(rev, currency)} | {_fmt_money(costs, currency)} | {_fmt_money(net, currency)} | {_fmt_money(cash, currency)} |"
        )
    return "\n".join(lines)


def _render_cashflow_analysis(*, company: str, currency: str, validation: dict | None, starting_cash: float) -> str:
    if not validation or not isinstance(validation.get("metrics"), dict):
        return "Run Idea Validation first to generate a deterministic baseline for cashflow."
    metrics = validation["metrics"]
    rev    = float(metrics.get("revenue_monthly") or 0.0)
    costs  = float(metrics.get("costs_monthly") or 0.0)
    net    = float(metrics.get("net_monthly") or 0.0)
    runway = metrics.get("runway_months")
    parts: list[str] = []
    parts.append("## Baseline (Monthly)")
    parts.append(f"- Revenue: {_fmt_money(rev, currency)}")
    parts.append(f"- Costs: {_fmt_money(costs, currency)}")
    parts.append(f"- Net: {_fmt_money(net, currency)}")
    parts.append(f"- Runway: {_fmt_months(runway)}")
    parts.append("")
    parts.append("## 12-Month Cashflow (Deterministic)")
    parts.append(_render_cashflow_12m_table(currency=currency, monthly_revenue=rev, monthly_costs=costs, starting_cash=starting_cash))
    parts.append("")
    parts.append("## Notes")
    if net >= 0:
        parts.append("- You are cashflow-positive under the current assumptions. Prioritize demand validation and capacity planning.")
    else:
        parts.append("- You are cashflow-negative under the current assumptions. Consider reducing fixed costs, improving pricing, or tightening payment terms.")
    parts.append("- This analysis is deterministic and updates directly when your inputs change.")
    return "\n".join(parts).strip()


def _render_financial_projection(*, currency: str, validation: dict | None, starting_cash: float) -> str:
    if not validation or not isinstance(validation.get("metrics"), dict):
        return "Run Idea Validation first to generate a deterministic baseline for projections."
    metrics    = validation["metrics"]
    rev        = float(metrics.get("revenue_monthly") or 0.0)
    costs      = float(metrics.get("costs_monthly") or 0.0)
    net        = float(metrics.get("net_monthly") or 0.0)
    margin     = float(metrics.get("margin") or 0.0)
    break_even = metrics.get("break_even_months")
    runway     = metrics.get("runway_months")
    parts: list[str] = []
    parts.append("## Baseline Snapshot")
    parts.append(f"- Monthly revenue: {_fmt_money(rev, currency)}")
    parts.append(f"- Monthly costs: {_fmt_money(costs, currency)}")
    parts.append(f"- Monthly net: {_fmt_money(net, currency)}")
    parts.append(f"- Contribution margin: {_fmt_pct(margin)}")
    parts.append(f"- Break-even: {_fmt_months(break_even)}")
    parts.append(f"- Runway: {_fmt_months(runway)}")
    parts.append("")
    parts.append("## 12-Month Projection (Constant-assumption)")
    parts.append(_render_cashflow_12m_table(currency=currency, monthly_revenue=rev, monthly_costs=costs, starting_cash=starting_cash))
    parts.append("")
    parts.append("## Assumptions")
    parts.append("- Revenue and costs are held constant at the baseline monthly assumptions from your validation inputs.")
    parts.append("- Update your inputs to re-generate an updated projection.")
    return "\n".join(parts).strip()


async def generate_blueprint(
    payload: BlueprintGenerateRequest,
    *,
    user_id: str | None = None,
) -> BlueprintGenerateResponse:
    warnings: list[str] = []
    llm: LLMClient
    try:
        if user_id:
            llm = await pick_llm_for_user(user_id)
        else:
            llm = AutoLLMClient()
        s = get_settings()
        if not (s.claude_api_key or s.gemini_api_key or s.openai_api_key):
            warnings.append("Text enhancement is unavailable; returned template-only document.")
    except Exception:
        llm = NoopLLMClient()
        warnings.append("Text enhancement is unavailable; returned template-only document.")

    today = _today_string()

    if isinstance(llm, NoopLLMClient) and payload.type in ("business_plan", "client_proposal", "sales_letter"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LLM provider not configured. Add OPENAI_API_KEY (preferred) or another provider to generate this document.",
        )

    company       = _safe_text(payload.company_name)
    tone          = _safe_text(payload.tone) or "professional"
    industry      = _safe_text(payload.industry)
    pricing_model = _safe_text(payload.pricing_model)

    # Allow numeric values only when explicitly supplied by the user/system.
    problem    = _safe_text(payload.problem)
    solution   = _safe_text(payload.solution)
    target     = _safe_text(payload.target_market)
    value_prop = _safe_text(payload.value_proposition)
    extra      = _safe_text(payload.extra_notes)
    objective  = _safe_text(getattr(payload, "objective", None))

    provider = "noop"
    model    = "none"

    validation: dict | None = None
    currency      = "GBP"
    starting_cash = 0.0
    workspace_context: dict[str, str] = {}
    workspace_logo_data_url = _safe_text(getattr(payload, "logo_data_url", None))

    ws: Any | None = None
    if payload.workspace_id and user_id:
        try:
            ws  = await get_validation_workspace(user_id=user_id, workspace_id=payload.workspace_id)
            cur = _extract_currency_from_workspace_data(ws.data)
            if cur:
                currency = cur
            starting_cash     = _extract_starting_cash_from_workspace(ws.data)
            workspace_context = _extract_business_context_from_workspace(ws.data)
            
            # Add selected services to workspace context if provided
            if payload.selected_services:
                workspace_context["selected_services"] = ", ".join(filter(None, payload.selected_services))
            
            # Only run the full validation engine for financial doc types — not business_plan
            # (business_plan uses the workspace-financials fallback below instead)
            if payload.type in ("cashflow_analysis", "financial_projection"):
                validation = await evaluate_validation(user_id=user_id, workspace_id=payload.workspace_id, inputs=None, idea_validation=None)
        except Exception as e:
            validation = None
            if payload.workspace_id:
                warnings.append(f"Could not load workspace (ID: {payload.workspace_id}). Proceeding with provided inputs only.")
    if not workspace_logo_data_url and ws and isinstance(ws.data, dict):
        workspace_profile = ws.data.get("workspace_profile") if isinstance(ws.data.get("workspace_profile"), dict) else {}
        workspace_logo_data_url = _safe_text(workspace_profile.get("logo_data_url"))
    
    # Verify workspace has business profile if workspace_id provided
    if payload.workspace_id and not workspace_context:
        warnings.append("Workspace business profile not fully set up. Please complete your workspace profile.")

    if payload.include_validation_snapshot and not validation and ws:
        validation = _validation_from_workspace_financials(ws.data) or validation

    def _default_title(doc_type: str, company_name: str) -> str:
        c = (company_name or "").strip() or "Untitled"
        return f"{doc_type} for {c}"

    async def _persist_response(resp: BlueprintGenerateResponse) -> BlueprintGenerateResponse:
        if not user_id:
            return resp
        if not (resp.document_markdown and str(resp.document_markdown).strip()):
            warnings.append("Document was empty; nothing saved.")
            return resp

        type_to_title = {
            "business_plan": "Business Plan",
            "client_proposal": "Business Proposal",
            "sales_letter": "Sales Letter",
            "sales_quotation": "Sales Quotation",
            "invoice_template": "Invoice",
            "cashflow_analysis": "Cash Flow Forecast",
            "financial_projection": "Financial Projection",
        }
        title = _default_title(type_to_title.get(payload.type, "Document"), company)
        try:
            requested_id = _safe_text(getattr(payload, "document_id", None))
            if requested_id:
                patched = await update_document(
                    user_id=user_id,
                    document_id=requested_id,
                    patch=BlueprintDocumentUpdateRequest(
                        title=title,
                        document_markdown=resp.document_markdown,
                        # Clear any previously saved edited HTML so previews don't show stale content
                        # after a regenerate. Export will fall back to markdown when HTML is empty.
                        document_html="",
                    ),
                )
                if patched:
                    resp.document_id = patched.id
                    return resp

            doc_id = await create_document(
                user_id=user_id,
                type=payload.type,
                title=title,
                company_name=company,
                industry=industry or None,
                pricing_model=pricing_model or None,
                workspace_id=_safe_text(payload.workspace_id) or None,
                document_markdown=resp.document_markdown,
                document_html=None,
                provider=resp.provider,
                model=resp.model,
            )
            resp.document_id = doc_id
        except Exception as e:
            detail = str(e).strip() or type(e).__name__
            warnings.append(f"Could not save document: {detail}")
        return resp

    # â”€â”€ Helper: enrich â†’ generate â†’ fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async def _enrich_and_generate(
        doc_type: str,
        raw: dict,
        build_prompt_fn,
        fallback_template: str | None,
        *,
        allow_fallback: bool = True,
        skip_fill_keys: set[str] | None = None,
        fill_missing: bool = True,
        fallback_fn=_narrative_fallback,
    ) -> tuple[str, str, str]:
        """
        1. Build a complete input dict (fill missing fields deterministically).
        2. Strip digits from inputs before calling the LLM.
        3. Generate full document (single LLM call).
        4. If LLM returns empty, render a complete template-based fallback.
        """
        skip = skip_fill_keys or set()
        enriched: dict[str, Any] = {}
        for k, v in raw.items():
            key = str(k)
            val = _safe_text(v)
            if val or key in skip:
                enriched[key] = val
            else:
                enriched[key] = fallback_fn(key) if fill_missing else ""

        doc_prompt    = build_prompt_fn(enriched)
        doc, prov, mdl = await _generate_section(
            llm,
            prompt=doc_prompt,
            label=f"{doc_type}_full",
            warnings=warnings,
            feature=f"blueprint.{doc_type.lower().replace(' ', '_')}.full",
        )

        # Readable fallback — never return an empty skeleton
        if not doc:
            if not allow_fallback or not fallback_template:
                failure_detail = next(
                    (w for w in reversed(warnings) if w.startswith(f"AI generation failed for {doc_type}_full:")),
                    None,
                )
                if failure_detail:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"{failure_detail}. Check provider credentials, model access, and try again.",
                    )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"LLM returned empty output for {doc_type}. Check provider credentials and try again.",
                )
            warnings.append(f"Document generation returned empty for {doc_type} — using enriched fallback.")
            for key in set(_TEMPLATE_FIELD_RE.findall(fallback_template)):
                if not str(enriched.get(key) or "").strip():
                    enriched[key] = fallback_fn(key) if fill_missing else fallback_fn(key)
            try:
                doc = fallback_template.format(**enriched).strip()
            except Exception:
                doc = f"# {doc_type}\n\n" + "\n\n".join(
                    v for v in (enriched.get("overview"), enriched.get("problem"), enriched.get("solution")) if v
                )

        doc = _clean_document(doc)
        return doc, prov, mdl

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # BUSINESS PLAN
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "business_plan":
        workspace_profile = ws.data.get("workspace_profile") if ws and isinstance(ws.data, dict) else {}
        business_profile = ws.data.get("business_profile") if ws and isinstance(ws.data, dict) else {}

        services = workspace_profile.get("services") if isinstance(workspace_profile, dict) else []
        services_text = ""
        if isinstance(services, list):
            parts = []
            for s in services:
                if not isinstance(s, dict):
                    continue
                name = _safe_text(s.get("service_name"))
                desc = _safe_text(s.get("service_description"))
                cat = _safe_text(s.get("service_category"))
                row = " - ".join([p for p in [name, cat, desc] if p])
                if row:
                    parts.append(row)
            services_text = "\n".join(parts).strip()

        selected_services = [
            _safe_text(s) for s in (payload.selected_services or []) if isinstance(s, str) and _safe_text(s)
        ]
        selected_services_text = ""
        if selected_services:
            ws_by_name: dict[str, dict] = {}
            if isinstance(services, list):
                for s in services:
                    if isinstance(s, dict) and _safe_text(s.get("service_name")):
                        ws_by_name[_safe_text(s.get("service_name")).lower()] = s
            lines: list[str] = []
            for item in selected_services:
                ws_match = ws_by_name.get(item.lower())
                if ws_match:
                    name = _safe_text(ws_match.get("service_name"))
                    desc = _safe_text(ws_match.get("service_description"))
                    cat = _safe_text(ws_match.get("service_category"))
                    row = " - ".join([p for p in [name, cat, desc] if p])
                    lines.append(row or name)
                else:
                    lines.append(item)
            selected_services_text = "\n".join([l for l in lines if _safe_text(l)]).strip()

        section_id_to_title = {
            "executive_summary": "Executive Summary",
            "business_overview": "Business Overview",
            "products_services": "Products and Services",
            "market_analysis": "Market Analysis",
            "competitive_analysis": "Competitive Analysis",
            "business_model": "Business Model",
            "marketing_sales_strategy": "Marketing and Sales Strategy",
            "operations_plan": "Operations Plan",
            "management_organisation": "Management and Organisation",
            "financial_snapshot": "Financial Snapshot",
            "funding_requirements": "Funding Requirements",
            "risk_analysis_mitigation": "Risk Analysis and Mitigation",
            "conclusion": "Conclusion",
        }
        selected_sections = [s for s in (payload.sections or []) if isinstance(s, str)]
        selected_section_titles = [section_id_to_title.get(s, s) for s in selected_sections if _safe_text(s)]

        snapshot_text = ""
        if payload.include_validation_snapshot:
            if validation:
                snapshot_text = _render_validation_snapshot(currency=currency, validation=validation)
            else:
                snapshot_text = "Financial data has not been provided for this section."

        registration_number = _safe_text(
            workspace_profile.get("registration_number") if isinstance(workspace_profile, dict) else ""
        )
        registration_status = "Registered" if registration_number else "Registration details not provided"

        raw_inputs = {
            "company_name": company,
            "registration_status": registration_status,
            "registration_number": registration_number,
            "legal_structure": _safe_text(workspace_profile.get("business_type") if isinstance(workspace_profile, dict) else ""),
            "primary_industry": _safe_text(industry or (workspace_profile.get("primary_industry") if isinstance(workspace_profile, dict) else "")),
            "secondary_industries": ", ".join(workspace_profile.get("secondary_industries") or []) if isinstance(workspace_profile, dict) else "",
            "about_company": _safe_text(workspace_profile.get("about_company") if isinstance(workspace_profile, dict) else ""),
            "tagline": _safe_text(workspace_profile.get("tagline") if isinstance(workspace_profile, dict) else ""),
            "mission": _safe_text(workspace_profile.get("mission") if isinstance(workspace_profile, dict) else ""),
            "vision": _safe_text(workspace_profile.get("vision") if isinstance(workspace_profile, dict) else ""),
            "core_values": ", ".join(workspace_profile.get("core_values") or []) if isinstance(workspace_profile, dict) else "",
            "services": services_text,
            "selected_services_focus": selected_services_text,
            "target_customer_type": _safe_text(workspace_profile.get("target_customer_type") if isinstance(workspace_profile, dict) else ""),
            "primary_revenue_model": _safe_text(workspace_profile.get("primary_revenue_model") if isinstance(workspace_profile, dict) else ""),
            "key_offering_focus": _safe_text(workspace_profile.get("key_offering_focus") if isinstance(workspace_profile, dict) else ""),
            "operating_stage": _safe_text(workspace_profile.get("operating_stage") if isinstance(workspace_profile, dict) else ""),
            "delivery_model": _safe_text(workspace_profile.get("delivery_model") if isinstance(workspace_profile, dict) else ""),
            "employee_count": _safe_text(str(workspace_profile.get("employee_count") or "") if isinstance(workspace_profile, dict) else ""),
            "location": _safe_text(
                workspace_context.get("location")
                or (business_profile.get("location") if isinstance(business_profile, dict) else "")
            ),
            "problem": problem,
            "solution": solution,
            "target_market": target,
            "value_proposition": value_prop,
            "pricing_model": pricing_model,
            "objective": objective,
            "extra_notes": extra,
            "selected_section_ids": ", ".join(selected_sections),
            "selected_sections": ", ".join(selected_section_titles),
            "financial_snapshot": snapshot_text,
        }

        # Handle financial snapshot logic
        if payload.include_validation_snapshot and not snapshot_text:
            raw_inputs["financial_snapshot"] = "Financial data has not been provided for this section."

        # Fetch real market + risk data from SERP/Claude for chart sections
        chart_data_block = ""
        try:
            from app.modules.blueprint.chart_data_service import fetch_chart_data, format_chart_data_for_prompt
            location = raw_inputs.get("location") or ""
            chart_data = await fetch_chart_data(
                industry=raw_inputs.get("primary_industry") or industry,
                target_market=raw_inputs.get("target_customer_type") or target,
                problem=problem,
                location=location,
                validation_data=validation,
            )
            if chart_data:
                chart_data_block = format_chart_data_for_prompt(chart_data)
                raw_inputs["chart_data"] = chart_data_block
        except Exception as exc:
            logger.warning("chart_data_service error (non-fatal): %s", exc)

        # Full-document generation first, then backfill any missing sections deterministically.
        doc, provider, model = await _enrich_and_generate(
            "Business Plan",
            raw_inputs,
            build_business_plan_prompt,
            None,
            allow_fallback=False,
            fill_missing=False,
        )

        wanted_titles = selected_section_titles or [h.replace("## ", "").strip() for h in BUSINESS_PLAN_HEADINGS]
        wanted_titles = [title for title in wanted_titles if _safe_text(title).lower() != "cover page"]
        wanted_headings = [f"## {t}" for t in wanted_titles if _safe_text(t)]
        if wanted_headings:
            doc = await _ensure_section_bodies(
                llm,
                doc_type="Business Plan",
                wanted_headings=wanted_headings,
                raw_inputs=raw_inputs,
                doc=doc,
                warnings=warnings,
                target_words=750 if len(wanted_headings) <= 2 else 650,
            )
            doc = _filter_to_wanted_headings(doc, wanted_headings)
        else:
            doc = ""

        contact_details = ""
        if isinstance(workspace_profile, dict):
            contact_parts = [
                _safe_text(workspace_profile.get("email")),
                _safe_text(workspace_profile.get("phone_number")),
                _safe_text(workspace_profile.get("website")),
            ]
            contact_details = " | ".join([p for p in contact_parts if p])

        cover_lines: list[str] = []
        if _safe_text(raw_inputs.get("primary_industry")):
            cover_lines.append(f"**Industry:** {_safe_text(raw_inputs.get('primary_industry'))}")
        if _safe_text(raw_inputs.get("location")):
            cover_lines.append(f"**Location:** {_safe_text(raw_inputs.get('location'))}")
        if _safe_text(raw_inputs.get("registration_number")):
            cover_lines.append(f"**Registration:** {_safe_text(raw_inputs.get('registration_number'))}")
        if contact_details:
            cover_lines.append(f"**Contact:** {contact_details}")
        cover_lines.append(f"**Prepared on:** {today}")

        doc = _strip_preamble_before_first_h2(doc)
        doc = _apply_cover_page(
            doc,
            title=f"Business Plan for {company}",
            lines=cover_lines,
            logo_data_url=workspace_logo_data_url,
        )

        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # CLIENT PROPOSAL
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "client_proposal":
        workspace_profile = ws.data.get("workspace_profile") if ws and isinstance(ws.data, dict) else {}
        business_profile = ws.data.get("business_profile") if ws and isinstance(ws.data, dict) else {}

        services = workspace_profile.get("services") if isinstance(workspace_profile, dict) else []
        services_text = ""
        if isinstance(services, list):
            parts = []
            for s in services:
                if not isinstance(s, dict):
                    continue
                name = _safe_text(s.get("service_name"))
                desc = _safe_text(s.get("service_description"))
                cat = _safe_text(s.get("service_category"))
                row = " - ".join([p for p in [name, cat, desc] if p])
                if row:
                    parts.append(row)
            services_text = "\n".join(parts).strip()

        selected_services = [
            _safe_text(s) for s in (payload.selected_services or []) if isinstance(s, str) and _safe_text(s)
        ]
        selected_services_text = ""
        if selected_services:
            ws_by_name: dict[str, dict] = {}
            if isinstance(services, list):
                for s in services:
                    if isinstance(s, dict) and _safe_text(s.get("service_name")):
                        ws_by_name[_safe_text(s.get("service_name")).lower()] = s
            lines: list[str] = []
            for item in selected_services:
                ws_match = ws_by_name.get(item.lower())
                if ws_match:
                    name = _safe_text(ws_match.get("service_name"))
                    desc = _safe_text(ws_match.get("service_description"))
                    cat = _safe_text(ws_match.get("service_category"))
                    row = " - ".join([p for p in [name, cat, desc] if p])
                    lines.append(row or name)
                else:
                    lines.append(item)
            selected_services_text = "\n".join([l for l in lines if _safe_text(l)]).strip()

        client_name = _safe_text(payload.bill_to) or "Client name to be confirmed"
        proposal_title = _safe_text(getattr(payload, "proposal_title", None)) or f"Proposal for {client_name}"
        contact_details = _safe_text(getattr(payload, "contact_details", None))
        if not contact_details and isinstance(workspace_profile, dict):
            contact_parts = [
                _safe_text(workspace_profile.get("email")),
                _safe_text(workspace_profile.get("phone_number")),
                _safe_text(workspace_profile.get("website")),
            ]
            contact_details = " | ".join([p for p in contact_parts if p])

        section_id_to_title = {
            "cover_page": "Cover Page",
            "executive_summary": "Executive Summary",
            "client_needs": "Client Needs / Problem Statement",
            "proposed_solution": "Proposed Solution",
            "scope_of_work": "Scope of Work",
            "methodology": "Methodology / Approach",
            "timeline": "Timeline / Delivery Schedule",
            "pricing_terms": "Pricing and Payment Terms",
            "value_benefits": "Value Proposition / Benefits",
            "company_profile": "Company Profile",
            "terms_conditions": "Terms and Conditions",
            "acceptance": "Acceptance / Next Steps",
        }
        selected_sections = [s for s in (payload.sections or []) if isinstance(s, str)]
        selected_section_titles = [section_id_to_title.get(s, s) for s in selected_sections if _safe_text(s)]

        registration_number = _safe_text(
            workspace_profile.get("registration_number") if isinstance(workspace_profile, dict) else ""
        )
        registration_status = "Registered" if registration_number else "Registration details not provided"

        company_profile_text = "\n".join(
            [t for t in [
                _safe_text(workspace_profile.get("about_company") if isinstance(workspace_profile, dict) else ""),
                services_text
            ] if t]
        ).strip()

        raw_inputs = {
            "company_name": company,
            "client_name": client_name,
            "proposal_title": proposal_title,
            "contact_details": contact_details,
            "objective": objective,
            "industry": _safe_text(industry or (workspace_profile.get("primary_industry") if isinstance(workspace_profile, dict) else "")),
            "location": _safe_text(
                workspace_context.get("location")
                or (business_profile.get("location") if isinstance(business_profile, dict) else "")
            ),
            "registration_status": registration_status,
            "registration_number": registration_number,
            "executive_summary": "",
            "client_needs": _safe_text(problem or workspace_context.get("problem", "")),
            "proposed_solution": _safe_text(solution or selected_services_text or services_text or workspace_context.get("solution", "")),
            "scope_of_work": _safe_text(payload.items),
            "methodology": _safe_text(getattr(payload, "methodology", None)),
            "timeline": _safe_text(getattr(payload, "timeline", None)),
            "pricing_terms": _safe_text(payload.terms),
            "value_proposition": _safe_text(value_prop or workspace_context.get("value_proposition", "")),
            "company_profile": company_profile_text,
            "selected_services_focus": selected_services_text,
            "terms_conditions": _safe_text(getattr(payload, "terms_conditions", None)) or _safe_text(payload.terms),
            "next_steps": _safe_text(getattr(payload, "next_steps", None)),
            "selected_section_ids": ", ".join(selected_sections),
            "selected_sections": ", ".join(selected_section_titles),
        }

        doc, provider, model = await _enrich_and_generate(
            "Business Proposal",
            raw_inputs,
            build_client_proposal_prompt,
            None,
            allow_fallback=False,
            fill_missing=False,
        )

        wanted_titles = selected_section_titles or [h.replace("## ", "").strip() for h in CLIENT_PROPOSAL_HEADINGS]
        wanted_titles = [title for title in wanted_titles if _safe_text(title).lower() != "cover page"]
        wanted_headings = [f"## {t}" for t in wanted_titles if _safe_text(t)]
        if wanted_headings:
            doc = await _ensure_section_bodies(
                llm,
                doc_type="Business Proposal",
                wanted_headings=wanted_headings,
                raw_inputs=raw_inputs,
                doc=doc,
                warnings=warnings,
                target_words=650 if len(wanted_headings) <= 2 else 520,
            )
            doc = _filter_to_wanted_headings(doc, wanted_headings)
        else:
            doc = ""
        doc = _normalize_client_proposal_cover_page(
            doc,
            proposal_title=proposal_title,
            company_name=company,
            client_name=client_name,
            contact_details=contact_details,
            selected_services_focus=selected_services_text,
            logo_data_url=workspace_logo_data_url,
        )
        doc = _ensure_client_proposal_format(doc)

        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # SALES LETTER
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "sales_letter":
        if payload.word_count is None or payload.word_count <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter a target word count to generate a sales letter.",
            )
        sl_problem_note = _expand_note(
            field="problem",
            text=problem or workspace_context.get("problem", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        sl_solution_note = _expand_note(
            field="solution",
            text=solution or workspace_context.get("solution", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        sl_value_note = _expand_note(
            field="value_proposition",
            text=value_prop or workspace_context.get("value_proposition", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        sl_hook_note = _expand_note(
            field="hook",
            text=value_prop or workspace_context.get("value_proposition", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        offer_input = _safe_text(getattr(payload, "offer", None)) or (pricing_model or "")
        offer_map = {
            "one-time": "a one‑off service delivered to a clear standard, with scope agreed upfront",
            "subscription": "a recurring service that keeps standards consistent through scheduled delivery",
            "hourly": "flexible support billed by time, focused on dependable outcomes",
            "retainer": "a reserved capacity model that guarantees priority delivery and continuity",
            "usage-based": "a pay‑as‑you‑use approach with clear scope and transparent expectations",
        }
        offer_key = offer_input.strip().lower()
        offer_text = offer_map.get(offer_key, offer_input)
        contact_name = _safe_text(getattr(payload, "contact_name", None))
        client_name = contact_name or _safe_text(payload.bill_to) or target or "Client team"
        subject_line = _safe_text(getattr(payload, "subject_lines", None)) or objective
        followup_sequence = _safe_text(getattr(payload, "followup_sequence", None))

        section_guard = (
            "Write the requested content as final sales-letter copy. "
            "Do NOT ask the user for more inputs. "
            "Do NOT mention missing information. "
            "Do NOT refer to policies, tools, or being an AI. "
            "If details are limited, write general, non-claiming prose that still reads like a real letter."
        )
        section_prompts = {
            "headline": f"{section_guard} Write a {tone} headline line for a sales letter from {company} to {client_name}.",
            "hook": f"{section_guard} Write a {tone} opening hook paragraph for a sales letter from {company} to {client_name}. Context: {sl_hook_note}",
            "problem": f"{section_guard} Write a concise problem statement for {client_name}. Context: {sl_problem_note}",
            "solution": f"{section_guard} Write a concise solution introduction. Context: {sl_solution_note}",
            "benefits": f"{section_guard} Write bullet-point benefits (no numbers). Context: {sl_value_note}",
            "proof": f"{section_guard} Write a credibility paragraph (no numbers) for {company}. {extra}",
            "offer": f"{section_guard} Write a single-sentence offer for {company}. Context: {offer_text}",
            "cta": f"{section_guard} Write a single-sentence call to action for {company}.",
            "urgency": f"{section_guard} Write a single-sentence urgency line (no dates).",
            "closing": f"{section_guard} Write a warm closing paragraph for a sales letter.",
            "followup": f"{section_guard} Summarise this follow-up sequence in one or two sentences: {followup_sequence}",
        }

        if payload.sections:
            outputs: list[str] = []
            provider = "mixed"
            model = "mixed"
            section_titles = {
                "headline": "Headline",
                "hook": "Opening / Hook",
                "problem": "Problem Statement",
                "solution": "Solution Introduction",
                "benefits": "Benefits",
                "proof": "Proof / Credibility",
                "offer": "Offer",
                "cta": "Call to Action",
                "urgency": "Urgency / Scarcity",
                "closing": "Closing",
                "followup": "Follow-up Summary",
            }
            for sid in payload.sections:
                if sid not in section_prompts:
                    continue
                text, provider, model = await _generate_section(
                    llm,
                    prompt=section_prompts[sid],
                    label=f"sales_letter_{sid}",
                    warnings=warnings,
                )
                if _looks_like_clarification_or_refusal(text):
                    if sid == "headline":
                        text = _narrative_fallback("headline")
                    elif sid == "hook":
                        text = sl_hook_note
                    elif sid == "problem":
                        text = sl_problem_note
                    elif sid == "solution":
                        text = sl_solution_note
                    elif sid == "benefits":
                        text = _sales_letter_benefits_fallback(company=company, target_market=target)
                    elif sid == "proof":
                        text = _narrative_fallback("proof")
                    elif sid == "offer":
                        text = _narrative_fallback("offer")
                    elif sid == "cta":
                        text = _narrative_fallback("cta")
                    elif sid == "urgency":
                        text = _narrative_fallback("urgency")
                    elif sid == "closing":
                        text = _narrative_fallback("closing")
                    elif sid == "followup":
                        text = (
                            _safe_text(followup_sequence)
                            or "We will follow up with a brief reminder and recap of the key value, with a low-commitment invitation to connect."
                        )
                if not _safe_text(text):
                    # Never hard-fail section drafts; fall back to deterministic copy so the UI can still populate tiles.
                    if sid == "headline":
                        text = _narrative_fallback("headline")
                    elif sid == "hook":
                        text = sl_hook_note
                    elif sid == "problem":
                        text = sl_problem_note
                    elif sid == "solution":
                        text = sl_solution_note
                    elif sid == "benefits":
                        text = _sales_letter_benefits_fallback(company=company, target_market=target)
                    elif sid == "proof":
                        text = _narrative_fallback("proof")
                    elif sid == "offer":
                        text = _narrative_fallback("offer")
                    elif sid == "cta":
                        text = _narrative_fallback("cta")
                    elif sid == "urgency":
                        text = _narrative_fallback("urgency")
                    elif sid == "closing":
                        text = _narrative_fallback("closing")
                    elif sid == "followup":
                        text = (
                            _safe_text(followup_sequence)
                            or "We will follow up with a brief reminder and recap of the key value, with a low-commitment invitation to connect."
                        )
                text = _clean_sales_letter_snippet(
                    sid=sid,
                    text=text,
                    company=company,
                    client_name=client_name,
                    target_market=target,
                )
                if not _safe_text(text):
                    text = _strict_fallback_text()
                outputs.append(f"## {section_titles.get(sid, sid)}\n{text}")

            doc = f"# Sales Letter — {company}\n{today}\n\n" + "\n\n".join(outputs)
            return await _persist_response(
                BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
            )

        raw_inputs = {
            "company_name":         company,
            "client_name":          client_name,
            "target_audience":      target or workspace_context.get("target_market", ""),
            "word_count":           f"{payload.word_count} words",
            "letter_date":          today,
            "recipient_block":      f"To: {client_name}",
            "salutation":           client_name,
            "subject_line":         subject_line,
            "objective":            objective,
            "headline":             _safe_text(getattr(payload, "headline", None)) or "",
            "hook":                 sl_hook_note,
            "problem_statement":    sl_problem_note,
            "solution_introduction":sl_solution_note,
            "benefits":             _ensure_bullets(sl_value_note),
            "proof":                _safe_text(getattr(payload, "proof", None)) or "",
            "offer":                _sentence_case(offer_text),
            "cta":                  _sentence_case(_safe_text(getattr(payload, "cta", None)) or ""),
            "urgency":              _sentence_case(_safe_text(getattr(payload, "urgency", None)) or ""),
            "closing":              "",
            "name":                 _safe_text(getattr(payload, "sender_name", None)) or "",
            "position":             _safe_text(getattr(payload, "sender_position", None)) or "",
            "phone":                _safe_text(getattr(payload, "sender_phone", None)) or "",
            "email":                _safe_text(getattr(payload, "sender_email", None)) or "",
            "website":              _safe_text(getattr(payload, "sender_website", None)) or "",
            "followup_sequence":    followup_sequence,
        }

        doc, provider, model = await _enrich_and_generate(
            "Sales Letter",
            raw_inputs,
            build_sales_letter_prompt,
            SALES_LETTER_TEMPLATE,
            allow_fallback=False,
            skip_fill_keys={"subject_line", "followup_sequence"},
        )
        doc = _clean_sales_letter_full_text(doc)
        if _looks_like_clarification_or_refusal(doc):
            warnings.append("Sales letter generation returned meta/clarification text; using deterministic fallback.")
            doc = _render_template_with_fallback(SALES_LETTER_TEMPLATE, raw_inputs)
        doc = _normalize_sales_letter(
            doc,
            date_line=today,
            client_name=client_name,
            subject_line=subject_line,
        )
        signature_lines = [
            _safe_text(getattr(payload, "sender_name", None)) or "",
            _safe_text(getattr(payload, "sender_position", None)) or "",
            company,
            _safe_text(getattr(payload, "sender_email", None)) or "",
            _safe_text(getattr(payload, "sender_phone", None)) or "",
            _safe_text(getattr(payload, "sender_website", None)) or "",
        ]
        doc = _inject_signature_block(doc, signature_lines)
        # Sales letters should read like a single-page letter, no cover page.
        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # SALES QUOTATION
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "sales_quotation":
        scope_hint = _safe_text(solution) or workspace_context.get("solution", "") or _safe_text(payload.items) or ""
        scope_summary, provider, model = await _generate_section(
            llm,
            prompt=f"Write a {tone} scope summary for a quotation from {company}. Context: solution={solution}. {extra}",
            label="quote_scope",
            warnings=warnings,
        )
        notes, provider, model = await _generate_section(
            llm,
            prompt=f"Write {tone} quotation notes (no numbers) for {company}. {extra}",
            label="quote_notes",
            warnings=warnings,
        )
        terms, provider, model = await _generate_section(
            llm,
            prompt=f"Write {tone} quotation terms (no numbers) for {company}. {extra}",
            label="quote_terms",
            warnings=warnings,
        )
        doc = SALES_QUOTATION_TEMPLATE.format(
            company_name=company,
            bill_to=_safe_text(payload.bill_to) or "Client details supplied separately.",
            scope_summary=scope_summary or "Defined delivery scope with clear inclusions and service standards.",
            items_table=_quote_items_table(payload.items, scope_hint or scope_summary),
            notes=notes or "We are happy to clarify scope or adjust delivery details as needed.",
            terms=_safe_text(payload.terms) or (terms or "Terms and conditions."),
        )
        cover_lines = [
            f"Client — {_safe_text(payload.bill_to) or 'Client name to be confirmed'}",
            f"Prepared By — {company}",
        ]
        doc = _apply_cover_page(doc, title=f"Sales Quotation — {company}", lines=cover_lines, logo_data_url=workspace_logo_data_url)
        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # CASHFLOW ANALYSIS
    # AI-generated following the Standard Cash Flow Analysis PDF structure.
    # Validation metrics passed as narrative context — no raw numbers to LLM.
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "cashflow_analysis":
        fields = _render_cashflow_analysis_fields(
            company=company,
            currency=currency,
            validation=validation,
            starting_cash=starting_cash,
        )
        doc = CASHFLOW_ANALYSIS_TEMPLATE.format(company_name=company, **fields)
        cover_lines = [
            f"Company — {company}",
            "Report — Cash Flow Forecast",
            f"Period — {fields.get('period', 'Current assumptions')}",
        ]
        doc = _apply_cover_page(doc, title=f"Cash Flow Forecast — {company}", lines=cover_lines, logo_data_url=workspace_logo_data_url)
        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider="deterministic", model="none", warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # FINANCIAL PROJECTION
    # AI-generated narrative using user inputs and validation context.
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "financial_projection":
        projection = _render_financial_projection(currency=currency, validation=validation, starting_cash=starting_cash)
        doc = FINANCIAL_PROJECTION_TEMPLATE.format(company_name=company, projection=projection)
        cover_lines = [
            f"Company — {company}",
            "Report — Financial Projection",
            "Period — Baseline projection",
        ]
        doc = _apply_cover_page(doc, title=f"Financial Projection — {company}", lines=cover_lines, logo_data_url=workspace_logo_data_url)
        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider="deterministic", model="none", warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # INVOICE
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    notes, provider, model = await _generate_section(
        llm,
        prompt=f"Write {tone} invoice notes (no numbers) for {company}. {extra}",
        label="invoice_notes",
        warnings=warnings,
    )
    terms, provider, model = await _generate_section(
        llm,
        prompt=f"Write {tone} payment terms (no numbers) for {company}. {extra}",
        label="invoice_terms",
        warnings=warnings,
    )
    scope_hint = _safe_text(solution) or workspace_context.get("solution", "") or _safe_text(payload.items) or ""
    doc = INVOICE_TEMPLATE.format(
        company_name=company,
        bill_to=_safe_text(payload.bill_to) or "Client details supplied separately.",
        items_table=_invoice_items_table(payload.items, scope_hint),
        notes=notes or "Thank you for your business.",
        terms=_safe_text(payload.terms) or (terms or "Payment due upon receipt."),
    )
    cover_lines = [
        f"Client — {_safe_text(payload.bill_to) or 'Client name to be confirmed'}",
        f"Prepared By — {company}",
    ]
    doc = _apply_cover_page(doc, title=f"Invoice — {company}", lines=cover_lines, logo_data_url=workspace_logo_data_url)
    return await _persist_response(
        BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
    )


