from __future__ import annotations

"""
Blueprint document prompts and templates.

Core principle:
- AI is used ONLY to generate narrative text.
- AI must NOT introduce financial amounts, prices, percentages, dates, or any digits.
- Deterministic outputs (e.g., cashflow/projection tables) may include numbers because they
  come from user inputs + pure calculations, not the LLM.
"""


from app.modules.blueprint.prompts.system_policy import SYSTEM_POLICY
from app.modules.blueprint.prompts.business_plan import BUSINESS_PLAN_PROMPT
from app.modules.blueprint.prompts.client_proposal import CLIENT_PROPOSAL_PROMPT
from app.modules.blueprint.prompts.sales_letter import SALES_LETTER_PROMPT


# ======================================================================================
# DOCUMENT TEMPLATES (used for deterministic fallback rendering)
# ======================================================================================

BUSINESS_PLAN_TEMPLATE = """# Business Plan — {company_name}

## Executive Summary
{mission}

{hook}

{funding_request}

{overview}

## Business Overview
### Business Model
{business_model}

### Legal Structure (UK)
{legal_structure}

### Registration (UK)
{registration}

### Location
{location}

## Market Analysis
### Target Audience
{target_market}

### Competitor Analysis
{competitor_analysis}

### Market Trends
{market_trends}

## Products and Services
### The Problem
{problem}

### The Solution
{solution}

### Pricing Strategy
{pricing_strategy}

## Sales and Marketing
### Branding
{branding}

### Channels
{channels}

### Marketing Strategy
{go_to_market}

## Operational Plan
### Suppliers
{suppliers}

### Technology
{technology}

### Insurance
{insurance}

{operations}

## Management and Personnel
### The Team
{team}

### Hiring Plan
{hiring_plan}

## Financial Plan
### Sales Forecast
{sales_forecast}

### Cash Flow Statement
{cashflow_summary}

### Break Even Analysis
{breakeven}

## Risk Analysis
### Market Risk
{risk_market}

### Financial Risk
{risk_financial}

### Operational Risk
{risk_operational}

### Regulatory Risk
{risk_regulatory}

## Growth Strategy
{market_expansion}

{product_roadmap}

{partnerships}

{technology_adoption}

{operational_expansion}

## Conclusion
{conclusion}
"""


CLIENT_PROPOSAL_TEMPLATE = """# Proposal for {client_name}

## Cover Page
Proposal Title — {proposal_title}
Client — {client_name}
Prepared By — {company_name}
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

Dear {salutation},

{headline}

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
    return SALES_LETTER_PROMPT.format(
        company_name=inputs.get("company_name", "the company"),
        client_name=inputs.get("client_name", "the client"),
        formatted_inputs=formatted,
    )

