from __future__ import annotations

"""
Blueprint document prompts and templates.

Core principle:
- AI is used ONLY to generate narrative text.
- AI must NOT introduce financial amounts, prices, percentages, dates, or any digits.
- Deterministic outputs (e.g., cashflow/projection tables) may include numbers because they come from user inputs + pure calculations, not the LLM.
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
{executive_summary}

## Business Overview
{business_overview}

## Products and Services
{products_services}

## Market Analysis
{market_analysis}

## Competitive Analysis
{competitive_analysis}

## Business Model
{business_model}

## Marketing and Sales Strategy
{marketing_sales_strategy}

## Operations Plan
{operations_plan}

## Management and Organisation
{management_organisation}

## Financial Snapshot
{financial_snapshot}

## Funding Requirements
{funding_requirements}

## Risk Analysis and Mitigation
{risk_analysis_mitigation}

## Conclusion
{conclusion}
"""


CLIENT_PROPOSAL_TEMPLATE = """# Proposal for {client_name}

## Cover Page
Proposal Title — {proposal_title}
Prepared by — {company_name}
Prepared for — {client_name}
<div class="page-break"></div>

## Executive Summary
{executive_summary}

## Client Needs / Problem Statement
{client_needs}

## Proposed Solution
{proposed_solution}

## Scope of Work
{scope_of_work}

## Methodology / Approach
{methodology}

## Timeline / Delivery Schedule
{timeline}

## Pricing and Payment Terms
{pricing_terms}

## Value Proposition / Benefits
{value_proposition}

## Company Profile
{company_profile}

## Terms and Conditions
{terms_conditions}

## Acceptance / Next Steps
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
            display_val = "[not provided]"
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

