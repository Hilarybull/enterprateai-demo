from __future__ import annotations

import re
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.modules.blueprint.repository import create_document
from app.modules.blueprint.schemas import BlueprintGenerateRequest, BlueprintGenerateResponse
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
)
from app.modules.idea_validation.service import evaluate as evaluate_validation
from app.modules.idea_validation.service import get_workspace as get_validation_workspace
from app.modules.idea_validation.schemas import IdeaValidationPayload
from app.core.config import get_settings
from app.shared.llm.openai_client import AutoLLMClient, LLMClient, NoopLLMClient


def _safe_text(s: str | None) -> str:
    return (s or "").strip()

def _strip_digits(s: str | None) -> str:
    # Kept for backward compatibility in case older code paths call it.
    # We now allow numeric values that are explicitly provided by the system/user.
    return _safe_text(s)


def _expand_note(*, field: str, text: str, company: str, industry: str, target_market: str, pricing_model: str) -> str:
    """
    Deterministically expand very short user inputs into usable narrative notes.
    This is NOT an AI step; it exists to prevent "verbatim Q/A" looking documents
    when inputs are one-liners or when the LLM is unavailable.
    """
    t = _safe_text(text)
    if not t:
        return ""

    # If user gave substantial content, keep it (but we still treat as notes).
    if len(t) >= 120:
        return t

    c = company or "the business"
    i = industry or "the industry"
    tm = target_market or "the target customer"

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



def _clean_document(doc: str) -> str:
    """
    Light post-processing for readability:
    - collapse excessive blank lines
    - remove consecutive duplicate paragraphs
    """
    text = (doc or "").strip()
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


def _build_cover_page(title: str, lines: list[str]) -> str:
    clean_lines = [l for l in lines if isinstance(l, str) and l.strip()]
    body = "\n".join(clean_lines)
    return f"<div class=\"cover-page\">\n# {title}\n\n{body}\n</div>\n\n<div class=\"page-break\"></div>"


def _apply_cover_page(doc: str, *, title: str, lines: list[str]) -> str:
    cleaned = _strip_cover_section(doc)
    cover = _build_cover_page(title, lines)
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

    # Ensure timeline table
    timeline_idx = next((i for i, l in enumerate(lines) if l.strip() == "## Implementation Plan / Timeline"), None)
    if timeline_idx is not None:
        # find next section
        next_section_idx = next(
            (i for i in range(timeline_idx + 1, len(lines)) if lines[i].startswith("## ")),
            len(lines)
        )
        body = [l for l in lines[timeline_idx + 1:next_section_idx] if l.strip()]
        has_table = any("|" in l for l in body) and any("---" in l for l in body)
        if not has_table:
            table = [
                "| Phase | Focus | Timeline (days) |",
                "| --- | --- | --- |",
                "| Onboarding and discovery | Confirm objectives, collect requirements, and align stakeholders | Day One to Day Three |",
                "| Initial delivery and refinement | Start delivery, validate standards, and incorporate feedback | Day Four to Day Ten |",
                "| Stabilised ongoing delivery | Maintain consistent delivery with periodic reviews | Day Eleven onward |",
            ]
            lines = lines[:timeline_idx + 1] + [""] + table + [""] + lines[next_section_idx:]

    return "\n".join(lines)


def _narrative_fallback(title: str) -> str:
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
    block = "Sincerely,\n" + "\n".join(cleaned)
    if "Sincerely," in doc:
        before, _, after = doc.partition("Sincerely,")
        # Trim any existing lines after Sincerely
        tail = after.splitlines()
        # Keep nothing after the sign-off to avoid duplicates
        return before.rstrip() + "\n\n" + block
    return doc.rstrip() + "\n\n" + block


_TEMPLATE_FIELD_RE = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)}")


async def _generate_section(
    llm: LLMClient,
    *,
    prompt: str,
    label: str,
    warnings: list[str],
) -> tuple[str, str, str]:
    try:
        res = await llm.generate_text(system=SYSTEM_POLICY, prompt=prompt)
        text = res.text.strip()
        if text:
            text = strip_numbers(text)
        if not text:
            warnings.append(f"AI returned empty text for: {label}")
        return text, res.provider, res.model
    except Exception as e:
        warnings.append(f"AI generation failed for {label}: {type(e).__name__}")
        return "", "noop", "none"


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


def _render_validation_snapshot(*, currency: str, validation: dict | None) -> str:
    if not validation:
        return "Not available yet. Add financial inputs in your workspace to generate this snapshot."
    metrics  = validation.get("metrics") if isinstance(validation.get("metrics"), dict) else {}
    revenue    = metrics.get("revenue_monthly", 0.0)
    costs      = metrics.get("costs_monthly", 0.0)
    net        = metrics.get("net_monthly", 0.0)
    margin     = metrics.get("margin", 0.0)
    break_even = metrics.get("break_even_months")
    runway     = metrics.get("runway_months")

    def row(label: str, value: str) -> str:
        return f"{label:<28} {value}"

    lines: list[str] = []
    lines.append(row("Metric", "Value"))
    lines.append("-" * 42)
    lines.append(row("Monthly revenue", _fmt_money(float(revenue or 0.0), currency)))
    lines.append(row("Monthly costs", _fmt_money(float(costs or 0.0), currency)))
    lines.append(row("Monthly net", _fmt_money(float(net or 0.0), currency)))
    lines.append(row("Contribution margin", _fmt_pct(float(margin or 0.0))))
    lines.append(row("Break-even", _fmt_months(break_even)))
    lines.append(row("Runway", _fmt_months(runway)))
    return "\n".join(lines).strip()


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
    db: AsyncIOMotorDatabase | None = None,
    user_id: str | None = None,
) -> BlueprintGenerateResponse:
    warnings: list[str] = []
    llm: LLMClient
    try:
        llm = AutoLLMClient()
        s = get_settings()
        if not (s.claude_api_key or s.gemini_api_key or s.openai_api_key):
            warnings.append("Text enhancement is unavailable; returned template-only document.")
    except Exception:
        llm = NoopLLMClient()
        warnings.append("Text enhancement is unavailable; returned template-only document.")

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

    provider = "noop"
    model    = "none"

    validation: dict | None = None
    currency      = "USD"
    starting_cash = 0.0
    workspace_context: dict[str, str] = {}

    if payload.workspace_id and db is not None and user_id:
        try:
            ws  = await get_validation_workspace(db, user_id=user_id, workspace_id=payload.workspace_id)
            cur = _extract_currency_from_workspace_data(ws.data)
            if cur:
                currency = cur
            starting_cash     = _extract_starting_cash_from_workspace(ws.data)
            workspace_context = _extract_business_context_from_workspace(ws.data)
            if payload.include_validation_snapshot or payload.type in ("cashflow_analysis", "financial_projection"):
                validation = await evaluate_validation(db, user_id=user_id, workspace_id=payload.workspace_id, inputs=None, idea_validation=None)
        except Exception:
            validation = None

    def _default_title(doc_type: str, company_name: str) -> str:
        c = (company_name or "").strip() or "Untitled"
        return f"{doc_type} — {c}"

    async def _persist_response(resp: BlueprintGenerateResponse) -> BlueprintGenerateResponse:
        if not (db is not None and user_id):
            return resp
        if not (resp.document_markdown and str(resp.document_markdown).strip()):
            warnings.append("Document was empty; nothing saved.")
            return resp

        type_to_title = {
            "business_plan": "Business Plan",
            "client_proposal": "Client Proposal",
            "sales_letter": "Sales Letter",
            "sales_quotation": "Sales Quotation",
            "invoice_template": "Invoice",
            "cashflow_analysis": "Cash Flow Forecast",
            "financial_projection": "Financial Projection",
        }
        title = _default_title(type_to_title.get(payload.type, "Document"), company)
        try:
            doc_id = await create_document(
                db,
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
        except Exception:
            warnings.append("Could not save document; you can still copy/download this preview.")
        return resp

    # â”€â”€ Helper: enrich â†’ generate â†’ fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async def _enrich_and_generate(
        doc_type: str,
        raw: dict,
        build_prompt_fn,
        fallback_template: str,
    ) -> tuple[str, str, str]:
        """
        1. Build a complete input dict (fill missing fields deterministically).
        2. Strip digits from inputs before calling the LLM.
        3. Generate full document (single LLM call).
        4. If LLM returns empty, render a complete template-based fallback.
        """
        enriched: dict[str, Any] = {}
        for k, v in raw.items():
            val = _safe_text(v)
            enriched[str(k)] = val if val else _narrative_fallback(str(k))

        doc_prompt    = build_prompt_fn(enriched)
        doc, prov, mdl = await _generate_section(llm, prompt=doc_prompt, label=f"{doc_type}_full", warnings=warnings)

        # Readable fallback — never return an empty skeleton
        if not doc:
            warnings.append(f"Document generation returned empty for {doc_type} — using enriched fallback.")
            # Use the document's template shape so the output still reads like a real deliverable.
            for key in set(_TEMPLATE_FIELD_RE.findall(fallback_template)):
                if not str(enriched.get(key) or "").strip():
                    enriched[key] = _narrative_fallback(key)
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
        # If the value proposition is a single word (e.g., "quality"), do not pass it as the hook.
        # The hook must be written as contextual narrative, not copied from input.
        hook_input = value_prop or workspace_context.get("value_proposition", "")
        if len(hook_input.split()) < 3:
            hook_input = ""

        mission_seed = ""
        if industry and target:
            mission_seed = f"{industry} services for {target}"
        elif industry:
            mission_seed = f"{industry} services"
        elif target:
            mission_seed = f"services for {target}"

        target_note = _expand_note(
            field="target_market",
            text=target or workspace_context.get("target_market", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        problem_note = _expand_note(
            field="problem",
            text=problem or workspace_context.get("problem", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        solution_note = _expand_note(
            field="solution",
            text=solution or workspace_context.get("solution", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        value_note = _expand_note(
            field="value_proposition",
            text=value_prop or workspace_context.get("value_proposition", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        pricing_note = _expand_note(
            field="pricing_strategy",
            text=pricing_model or "",
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        mission_note = _expand_note(
            field="mission",
            text=mission_seed,
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        hook_note = _expand_note(
            field="hook",
            text=hook_input,
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )

        snapshot_text = ""
        if payload.include_validation_snapshot:
            snapshot_text = _render_validation_snapshot(currency=currency, validation=validation)

        raw_inputs = {
            "company_name":          company,
            "industry":              industry or workspace_context.get("industry", "") or workspace_context.get("primary_industry", ""),
            "mission":               mission_note,
            "hook":                  hook_note,
            "funding_request":       "",
            "overview":              extra or "",
            "legal_structure":       "",
            "registration":          "",
            "location":              workspace_context.get("location", ""),
            "business_overview":     "",
            "target_market":         target_note,
            "competitor_analysis":   "",
            "market_trends":         "",
            "problem":               problem_note,
            "solution":              solution_note,
            "value_proposition":     value_note,
            "pricing_strategy":      pricing_note,
            "branding":              "",
            "channels":              "",
            "go_to_market":          "",
            "suppliers":             "",
            "technology":            "",
            "insurance":             "",
            "operations":            "",
            "team":                  "",
            "hiring_plan":           "",
            "sales_forecast":        "",
            "cashflow_summary":      "",
            "breakeven":             "",
            "risks":                 "",
            "market_expansion":      "",
            "product_roadmap":       "",
            "partnerships":          "",
            "technology_adoption":   "",
            "operational_expansion": "",
            "conclusion":            "",
            "financial_snapshot":    snapshot_text,
        }

        doc, provider, model = await _enrich_and_generate(
            "Business Plan", raw_inputs, build_business_plan_prompt, BUSINESS_PLAN_TEMPLATE
        )

        if payload.include_validation_snapshot:
            snapshot = _render_validation_snapshot(currency=currency, validation=validation)
            doc = f"{doc}\n\nFINANCIAL SNAPSHOT\n\n{snapshot}\n"

        cover_lines = [
            f"Company — {company}",
            f"Industry — {industry}" if industry else "",
            f"Target Market — {target}" if target else "",
            "Prepared For — Internal business use",
        ]
        doc = _apply_cover_page(doc, title=f"Business Plan — {company}", lines=cover_lines)

        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # CLIENT PROPOSAL
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "client_proposal":
        client_problem_note = _expand_note(
            field="problem",
            text=problem or workspace_context.get("problem", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        client_solution_note = _expand_note(
            field="solution",
            text=solution or workspace_context.get("solution", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        client_value_note = _expand_note(
            field="value_proposition",
            text=value_prop or workspace_context.get("value_proposition", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        client_target_note = _expand_note(
            field="target_market",
            text=target or workspace_context.get("target_market", ""),
            company=company,
            industry=industry,
            target_market=target or workspace_context.get("target_market", ""),
            pricing_model=pricing_model,
        )
        client_constraints_note = (
            "Key constraints include maintaining service consistency, aligning expectations across stakeholders, and ensuring delivery standards are met without "
            "adding operational complexity. The proposal is designed to reduce risk while keeping execution simple and reliable."
        )
        scope_included_note = (
            "Discovery and onboarding, service design aligned to your requirements, delivery with clear standards, and ongoing quality assurance."
        )
        scope_excluded_note = (
            "Out‑of‑scope items are any requests that change the agreed service definition, require additional tooling, or introduce new delivery locations without a prior review."
        )
        assumptions_note = (
            "Assumes access to required locations, timely communication on scheduling, and a single point of contact for approvals and feedback."
        )
        timeline_note = (
            "| Phase | Focus | Timeline (days) |\n"
            "| --- | --- | --- |\n"
            "| Onboarding and discovery | Confirm objectives, collect requirements, and align stakeholders | Day One to Day Three |\n"
            "| Initial delivery and refinement | Start delivery, validate standards, and incorporate feedback | Day Four to Day Ten |\n"
            "| Stabilised ongoing delivery | Maintain consistent delivery with periodic reviews | Day Eleven onward |"
        )
        commercial_terms_note = (
            "Commercial terms are structured around transparent service inclusions, straightforward payment expectations, and fair handling of scope changes."
        )
        business_impact_note = (
            "The proposal is designed to reduce operational friction, improve consistency, and free internal teams from day‑to‑day coordination overhead."
        )
        efficiency_note = (
            "Standardised delivery and clear communication reduce rework, shorten resolution time, and improve predictability for internal stakeholders."
        )
        advantage_note = (
            "The approach emphasises reliability and accountability, which differentiates the service from informal or inconsistent alternatives."
        )
        risk_reduction_note = (
            "Risks are mitigated through documented standards, quality checks, and a structured feedback loop."
        )
        company_info_note = f"{company} provides reliable delivery in {industry} with a focus on consistency and professional standards." if industry else f"{company} delivers reliable, standards‑led services with a focus on consistency."
        terms_note = (
            "Terms cover confidentiality, reasonable liability limits, and clear cancellation and change procedures to protect both parties."
        )
        next_steps_note = (
            "Confirm scope and expectations, agree the start window, and schedule the onboarding session to begin delivery."
        )
        raw_inputs = {
            "company_name":        company,
            "client_name":         _safe_text(payload.bill_to) or "Client name to be confirmed",
            "proposal_title":      _safe_text(getattr(payload, "proposal_title", None)) or f"Proposal from {company}",
            "date":                "",
            "contact_details":     _safe_text(getattr(payload, "contact_details", None)) or f"Contact {company} to confirm details",
            "summary":             client_value_note or business_impact_note,
            "client_situation":    client_problem_note,
            "pain_points":         client_problem_note,
            "client_goals":        client_target_note,
            "constraints":         client_constraints_note,
            "approach":            client_solution_note,
            "scope_included":      _safe_text(payload.items) or scope_included_note,
            "scope_exclusions":    _safe_text(getattr(payload, "scope_exclusions", None)) or scope_excluded_note,
            "assumptions":         _safe_text(getattr(payload, "assumptions", None)) or assumptions_note,
            "timeline":            _safe_text(getattr(payload, "timeline", None)) or timeline_note,
            "commercial_terms":    _safe_text(payload.terms) or commercial_terms_note,
            "business_impact":     client_value_note or business_impact_note,
            "roi":                 "Value is delivered through reduced rework, clearer expectations, and fewer service disruptions.",
            "efficiency_gains":    efficiency_note,
            "competitive_advantage": advantage_note,
            "risk_reduction":      risk_reduction_note,
            "company_info":        company_info_note,
            "deliverables":        "A clear service definition, onboarding plan, delivery checklist, and quality review process.",
            "terms_and_conditions": terms_note,
            "next_steps":          next_steps_note,
        }

        doc, provider, model = await _enrich_and_generate(
            "Client Proposal", raw_inputs, build_client_proposal_prompt, CLIENT_PROPOSAL_TEMPLATE
        )
        doc = _ensure_client_proposal_format(doc)
        if payload.include_validation_snapshot:
            snapshot = _render_validation_snapshot(currency=currency, validation=validation)
            doc = f"{doc}\n\nFINANCIAL SNAPSHOT\n\n{snapshot}\n"
        cover_lines = [
            f"Proposal Title — {raw_inputs.get('proposal_title')}",
            f"Client — {raw_inputs.get('client_name')}",
            f"Prepared By — {company}",
            f"Contact Details — {raw_inputs.get('contact_details')}",
        ]
        doc = _apply_cover_page(doc, title=f"Client Proposal — {company}", lines=cover_lines)
        return await _persist_response(
            BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
        )

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    # SALES LETTER
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if payload.type == "sales_letter":
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

        raw_inputs = {
            "company_name":         company,
            "target_audience":      target or workspace_context.get("target_market", ""),
            "letter_date":          "Date: available upon request",
            "recipient_block":      f"To: {target or 'Client team'}\nCompany: {company}",
            "salutation":           target or "Client team",
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
            "subjects":             _safe_text(getattr(payload, "subject_lines", None)) or "",
            "followups":            _safe_text(getattr(payload, "followup_sequence", None)) or "",
        }

        doc, provider, model = await _enrich_and_generate(
            "Sales Letter", raw_inputs, build_sales_letter_prompt, SALES_LETTER_TEMPLATE
        )
        signature_lines = [
            _safe_text(getattr(payload, "sender_name", None)) or "Client Services Team",
            _safe_text(getattr(payload, "sender_position", None)) or "Client Services",
            company,
            _safe_text(getattr(payload, "sender_phone", None)) or "",
            _safe_text(getattr(payload, "sender_email", None)) or "",
            _safe_text(getattr(payload, "sender_website", None)) or "",
        ]
        doc = _inject_signature_block(doc, signature_lines)
        cover_lines = [
            f"Company — {company}",
            f"Audience — {target}" if target else "",
            f"Offer — {value_prop}" if value_prop else "",
        ]
        doc = _apply_cover_page(doc, title=f"Sales Letter — {company}", lines=cover_lines)
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
        doc = _apply_cover_page(doc, title=f"Sales Quotation — {company}", lines=cover_lines)
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
        doc = _apply_cover_page(doc, title=f"Cash Flow Forecast — {company}", lines=cover_lines)
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
        doc = _apply_cover_page(doc, title=f"Financial Projection — {company}", lines=cover_lines)
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
    doc = _apply_cover_page(doc, title=f"Invoice — {company}", lines=cover_lines)
    return await _persist_response(
        BlueprintGenerateResponse(document_markdown=doc, provider=provider, model=model, warnings=warnings)
    )


