from __future__ import annotations

"""
Blueprint document prompts and templates.

Core principle:
- AI is used ONLY to generate narrative text.
- AI must NOT introduce financial amounts, prices, percentages, dates, or any digits.
- Deterministic outputs (e.g., cashflow/projection tables) may include numbers because they
  come from user inputs + pure calculations, not the LLM.
"""


# ======================================================================================
# SYSTEM POLICY
# ======================================================================================

SYSTEM_POLICY = """You are EnterprateAI's expert UK business document writer.

YOUR ONLY JOB IS TO WRITE FULLY COMPLETED BUSINESS DOCUMENTS THAT ARE SUBMISSION-READY.

ABSOLUTE RULES — NEVER BREAK THESE:
- NEVER output a template with empty sections; every section must contain fully written content.
- NEVER reproduce input labels or raw user phrasing verbatim; rewrite professionally.
- NEVER copy any input sentence or any phrase longer than three words.
- NEVER output placeholders such as "TBD", "N/A", "Add details here", or leave blanks.
- NEVER write meta commentary such as "This section provides", "This section will be completed", or "The focus is".
- NEVER include any digits anywhere in your output.
- NEVER include financial amounts, prices, percentages, VAT rates, timelines with dates, or numeric forecasts.
  Explain financial sections narratively using words only.

QUALITY RULES:
- Each section must be coherent, specific, and decision‑ready.
- Use short paragraphs, clear headings, and bullet points where helpful.
- Avoid repetition across sections; do not restate the same paragraph or idea verbatim.
- Expand brief inputs into complete professional narrative.

STYLE:
- Formal, professional British English.
- Specific to the company, industry, and UK context.
"""


# ======================================================================================
# DOCUMENT GENERATION PROMPTS (must follow UK outlines provided by user)
# ======================================================================================

BUSINESS_PLAN_PROMPT = """
Write a complete UK Business Plan for {company_name}, strictly following the outline below.

INPUTS (some may be brief or blank — you must infer intelligently from context):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order.
- Write a finished document — no skeletons, no placeholders.
- Do not include digits anywhere.
- Do not include financial amounts, prices, percentages, or dates.
- Treat the inputs as brief notes; do not copy phrases verbatim. Paraphrase and expand.
- Avoid repetition across sections; each section must add new value and context.

OUTPUT FORMAT:
Markdown with the headings exactly as shown.

---

# Business Plan — {company_name}

## Executive Summary
- The Mission: one sentence describing what the business does.
- The Hook: why the business will succeed in the UK market.
- The Request: if funding is relevant, explain what it is for (in words only); otherwise explain the bootstrapping approach.

Write this section as several strong paragraphs, then include a short bullet recap.
The Hook must be contextual and specific (minimum one paragraph) — never a single word.

## Business Overview
- Legal Structure (UK): recommended structure and rationale.
- Registration (UK): registration readiness, Companies House and VAT considerations in principle.
- Location: where the business operates from and why.

Write in narrative form and make it specific to the business.

## Market Analysis
- Target Audience: UK customer avatar (who they are, behaviours, spending mindset, buying triggers).
- Competitor Analysis: identify competitor types and provide a SWOT-style view of the landscape.
- Market Trends: UK-specific trends and timing factors.

## Products and Services
- The Problem: the customer pain point, consequences, why it matters now.
- The Solution: what is delivered, how it works, and what makes it distinct.
- Pricing Strategy: packaging and pricing approach in words, including VAT handling in principle (no numbers).

## Sales and Marketing
- Branding: positioning, trust signals, tone of voice.
- Channels: where the business sells and how customers discover it.
- Marketing Strategy: practical go-to-market plan and early validation activities.

## Operational Plan
- Suppliers: sourcing/partners, reliability, quality control.
- Technology: tools/systems to run the business (UK compliance-aware where relevant).
- Insurance: appropriate UK insurance posture in principle.

## Management and Personnel
- The Team: roles, responsibilities, execution capability.
- Hiring: contractors vs employees, and UK compliance considerations in principle.

## Financial Plan
- Sales Forecast: narrative forecast and assumptions (no numbers).
- Cash Flow Statement: narrative view of inflows/outflows and liquidity management.
- Break-even Analysis: narrative path to break-even and levers that drive profitability.

## Risk Analysis
Cover market, financial, operational, and regulatory risks, with mitigations for each.

## Growth Strategy
Explain scaling: market expansion, product roadmap, partnerships, technology adoption, and operational expansion.

## Conclusion
Persuasive close with clear next steps.
"""


CLIENT_PROPOSAL_PROMPT = """
Write a complete UK Client Proposal on behalf of {company_name}, addressed to {client_name}.
Follow the UK proposal outline below strictly.

INPUTS (some may be brief or blank — you must infer intelligently from context):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order.
- Write a finished proposal — no placeholders.
- Do not include digits anywhere.
- Do not include prices, VAT rates, dates, or numbered timelines.
- Avoid repetition across sections; each section must add new value and context.

OUTPUT FORMAT:
Markdown with the headings exactly as shown.

---

# Client Proposal — {company_name}

## Cover Page
Provide a short cover block with proposal title, client name, your company name, and contact details (written out).
Keep it concise and presentation‑ready (no placeholder labels).
After the cover block, insert a page break using: <div class="page-break"></div>

## Executive Summary
Concise persuasive overview: client need, proposed solution, key benefits, and why you are the right partner.

## Understanding of Client Needs
Demonstrate understanding: situation, pain points, objectives, and constraints.

## Proposed Solution
Describe the solution, methodology, key services, and deliverables at a high level.

## Scope of Work
Define tasks and activities, boundaries, assumptions, and exclusions to prevent scope creep.

## Implementation Plan / Timeline
Provide a short table with phases and timeline in days, written out in words (no digits).
Example day labels: Day One, Day Two, Day Three.

## Pricing and Payment Terms
Explain pricing model and payment schedule in principle, including VAT handling in principle (no numbers).

## Value Proposition / Benefits
Focus on outcomes: business impact, efficiency gains, competitive advantage, risk reduction.

## Company Information
Credibility: experience, expertise, relevant work, certifications/accreditations in principle, and key team members.

## Terms and Conditions
Summarise liability, confidentiality, cancellation terms, and intellectual property.

## Acceptance / Call to Action
Clear next steps for approval and onboarding, with contact details.
"""


SALES_LETTER_PROMPT = """
Write a complete UK-style Sales Letter for {company_name} that reads like a real letter a business would send to a client.

INPUTS (some may be brief or blank — you must infer intelligently from context):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order.
- Write a finished letter — no placeholders.
- Do not include digits anywhere.
- Do not include prices, discounts, dates, or numeric claims.
- Avoid repetition across sections; each section must add new value and context.
- The letter must feel genuine and client-ready, not a template or checklist.

OUTPUT FORMAT:
Write only the letter itself (no extra headings beyond the cover page).
Include a date line, recipient block, greeting, and sign‑off.
The letter should be continuous prose with short paragraphs and a confident, friendly tone.
Include, in order, the following elements inside the letter body (do not label them with extra headings):
- A bold headline line.
- Opening / hook.
- Problem statement.
- Solution introduction.
- Benefits as bullet points.
- Proof / credibility.
- Offer written as a natural sentence (no label).
- Clear call to action written as a sentence (no label).
- Urgency / scarcity written as a sentence (no label).
- Closing and sign-off with sender details.
"""


# ======================================================================================
# DOCUMENT TEMPLATES (used for deterministic fallback rendering)
# ======================================================================================

BUSINESS_PLAN_TEMPLATE = """# Business Plan — {company_name}

## Executive Summary
**The Mission:** {mission}

**The Hook:** {hook}

**The Request:** {funding_request}

{overview}

## Business Overview
**Legal Structure:** {legal_structure}

**Registration:** {registration}

**Location:** {location}

{business_overview}

## Market Analysis
**Target Audience:** {target_market}

**Competitor Analysis:** {competitor_analysis}

**Market Trends:** {market_trends}

## Products and Services
**The Problem:** {problem}

**The Solution:** {solution}

**Pricing Strategy:** {pricing_strategy}

## Sales and Marketing
**Branding:** {branding}

**Channels:** {channels}

**Marketing Strategy:** {go_to_market}

## Operational Plan
**Suppliers:** {suppliers}

**Technology:** {technology}

**Insurance:** {insurance}

{operations}

## Management and Personnel
**The Team:** {team}

**Hiring:** {hiring_plan}

## Financial Plan
**Sales Forecast:** {sales_forecast}

**Cash Flow Statement:** {cashflow_summary}

**Break-even Analysis:** {breakeven}

## Risk Analysis
{risks}

## Growth Strategy
**Market Expansion:** {market_expansion}

**Product Roadmap:** {product_roadmap}

**Strategic Partnerships:** {partnerships}

**Technology Adoption:** {technology_adoption}

**Hiring and Operational Expansion:** {operational_expansion}

## Conclusion
{conclusion}
"""


CLIENT_PROPOSAL_TEMPLATE = """# Client Proposal — {company_name}

## Cover Page
Proposal Title — {proposal_title}
Client — {client_name}
Prepared By — {company_name}
Contact Details — {contact_details}
<div class="page-break"></div>

## Executive Summary
{summary}

## Understanding of Client Needs
{client_situation}

{pain_points}

{client_goals}

{constraints}

## Proposed Solution
{approach}

## Scope of Work
**Included:** {scope_included}

**Exclusions:** {scope_exclusions}

**Assumptions:** {assumptions}

## Implementation Plan / Timeline
{timeline}

## Pricing and Payment Terms
{commercial_terms}

## Value Proposition / Benefits
{business_impact}

{roi}

{efficiency_gains}

{competitive_advantage}

{risk_reduction}

## Company Information
{company_info}

## Terms and Conditions
{terms_and_conditions}

## Acceptance / Call to Action
{next_steps}
"""


SALES_LETTER_TEMPLATE = """
{letter_date}

{recipient_block}

Dear {salutation},

**{headline}**

{hook}

{problem_statement}

{solution_introduction}

Benefits include:
{benefits}

{offer}

{cta}

{urgency}

{proof}

{closing}

Sincerely,
{name}
{position}
{company_name}
{phone}
{email}
{website}
"""


SALES_QUOTATION_TEMPLATE = """# Sales Quotation — {company_name}

## Quotation Summary
| Field | Details |
| --- | --- |
| Client | {bill_to} |
| Prepared by | {company_name} |
| Scope summary | {scope_summary} |

## Quotation Items
| Item | Scope | Billing basis | Notes |
| --- | --- | --- | --- |
{items_table}

## Notes
{notes}

## Terms
{terms}
"""


INVOICE_TEMPLATE = """# Invoice — {company_name}

### Invoice Details
| Field | Details |
| --- | --- |
| Client | {bill_to} |
| Prepared by | {company_name} |

### Invoice Items
| Description | Scope | Amount |
| --- | --- | --- |
{items_table}

### Notes
{notes}

### Terms
{terms}
"""


CASHFLOW_ANALYSIS_TEMPLATE = """# Cash Flow Forecast — {company_name}

### Report Details
| Field | Details |
| --- | --- |
| Report title | {report_type} |
| Period covered | {period} |

### Cash Position
| Item | Amount |
| --- | --- |
| Opening cash balance | {opening_balance} |
| Net cash flow (monthly) | {net_cashflow} |
| Closing cash balance | {closing_balance} |

### Cash Inflows
| Source | Notes | Amount |
| --- | --- | --- |
| Sales receipts | {sales_receipts_note} | {sales_receipts_value} |
| Other income | {other_income} | {other_income_value} |
| **Total inflows** |  | {total_inflows} |

### Cash Outflows
| Category | Notes | Amount |
| --- | --- | --- |
| Operating expenses | {operating_expenses_note} | {operating_expenses_value} |
| Cost of goods sold | {cogs} | {cogs_value} |
| Capital expenditure | {capex} | {capex_value} |
| Financial obligations | {financial_obligations} | {financial_obligations_value} |
| **Total outflows** |  | {total_outflows} |

### Forecast (Forward‑Looking)
{forecast}

### Assumptions
{assumptions}

### Scenario Analysis
- Best‑case: {best_case}
- Expected: {expected_case}
- Worst‑case: {worst_case}

### Key Insights
{insights}
"""


FINANCIAL_PROJECTION_TEMPLATE = """# Financial Projection — {company_name}

{projection}
"""


# ======================================================================================
# HELPERS
# ======================================================================================

def format_inputs_for_prompt(inputs: dict) -> str:
    lines: list[str] = []
    for key, value in inputs.items():
        display_key = str(key).replace("_", " ").title()
        if isinstance(value, str) and value.strip():
            display_val = value.strip()
        else:
            display_val = "[not provided — infer from context]"
        lines.append(f"{display_key}: {display_val}")
    return "\n".join(lines)


def build_business_plan_prompt(inputs: dict) -> str:
    formatted = format_inputs_for_prompt(inputs)
    return BUSINESS_PLAN_PROMPT.format(company_name=inputs.get("company_name", "the company"), formatted_inputs=formatted)


def build_client_proposal_prompt(inputs: dict) -> str:
    formatted = format_inputs_for_prompt(inputs)
    return CLIENT_PROPOSAL_PROMPT.format(
        company_name=inputs.get("company_name", "the company"),
        client_name=inputs.get("client_name", "the client"),
        formatted_inputs=formatted,
    )


def build_sales_letter_prompt(inputs: dict) -> str:
    formatted = format_inputs_for_prompt(inputs)
    return SALES_LETTER_PROMPT.format(company_name=inputs.get("company_name", "the company"), formatted_inputs=formatted)

