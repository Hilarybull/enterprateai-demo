BUSINESS_PLAN_PROMPT = """
Write a complete, submission-ready UK Business Plan for {company_name}, strictly following the outline below.
This is a formal business plan — not a proposal, not a sales letter.

INPUTS (some may be brief or blank — infer intelligently from context and industry norms):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order given. Do not add, remove, or rename headings.
- Write every section as finished, decision ready content — no skeletons, no placeholders, no "TBD", no "N/A".
- Do NOT fabricate financial amounts, prices, percentages, projections, or dates. Use only what is supplied in inputs.
- If a numeric value is missing, write around it in narrative form without inventing a figure.
- Do NOT copy input phrases verbatim. Always paraphrase and expand into professional narrative.
- Do NOT repeat the same idea across sections. Each section must add new, distinct value.
- Minimum one full paragraph per sub section. Bullet points may supplement but never replace prose.
- If a field is blank or insufficient, infer from industry context and write it as natural, confident narrative.
- Do NOT use unnecessary hyphens in the generated document. Write compound words and phrases as
  separate words unless the hyphen is grammatically required (e.g. well-established, up-to-date).

STYLE:
- Formal, professional British English throughout.
- Short paragraphs, clear headings, bullet points where appropriate.
- Specific to {company_name}, its industry, and the UK market context.

OUTPUT FORMAT:
Plain text, well formatted and consistently aligned — no Markdown symbols, no hashtags, no asterisks.
Use ALL CAPS for main section headings.
Use Title Case for sub headings.
Use indentation and line spacing to create visual structure and readability.

---

BUSINESS PLAN — {company_name}


EXECUTIVE SUMMARY

  Write several strong paragraphs covering:

    - What the business does (one clear sentence).
    - Why it will succeed in the UK market (minimum one full contextual paragraph — never vague).
    - If funding is relevant, explain what it is for in words only. If bootstrapped, explain the approach.

  End with a short indented bullet recap of the key highlights.


BUSINESS OVERVIEW

  Business Model
    How the business generates revenue in principle (no figures).

  Legal Structure (UK)
    Recommended structure and rationale (e.g. sole trader, limited company).

  Registration (UK)
    Readiness for Companies House registration and VAT considerations in principle.

  Location
    Where the business operates and why that location makes strategic sense.


MARKET ANALYSIS

  Target Audience
    A detailed UK customer avatar — who they are, their behaviours, spending mindset, and buying triggers.

  Competitor Analysis
    Identify competitor types and provide a SWOT style view of the competitive landscape.

  Market Trends
    UK specific trends, timing factors, and why now is the right moment.


PRODUCTS AND SERVICES

  The Problem
    The specific customer pain point, its consequences, and why it matters now.

  The Solution
    What is delivered, how it works, and what makes it distinctly different.

  Pricing Strategy
    Packaging and pricing approach in words, including VAT handling in principle (no figures).


SALES AND MARKETING

  Branding
    Positioning, trust signals, and tone of voice.

  Channels
    Where the business sells and how customers discover it.

  Marketing Strategy
    A practical go to market plan with early validation activities.


OPERATIONAL PLAN

  Suppliers
    Sourcing strategy, partner reliability, and quality control approach.

  Technology
    Tools and systems used to run the business, with UK compliance considerations where relevant.

  Insurance
    Appropriate UK insurance posture in principle (e.g. public liability, professional indemnity).


MANAGEMENT AND PERSONNEL

  The Team
    Roles, responsibilities, and execution capability.

  Hiring Plan
    Approach to contractors vs employees, and UK compliance considerations in principle (e.g. IR35, PAYE).


FINANCIAL PLAN

  Sales Forecast
    Narrative forecast and the assumptions that underpin it. No invented figures.

  Cash Flow Statement
    Narrative view of expected inflows, outflows, and liquidity management approach.

  Break Even Analysis
    Narrative path to break even and the key levers that drive profitability.


FINANCIAL SNAPSHOT  [Fetch from the system]

  Present a clean, plain text aligned summary table of the key financial figures supplied.
  Use ONLY figures explicitly provided in the inputs (look for the Financial Snapshot input).
  Do NOT invent, estimate, or extrapolate any value.
  If no figures are provided, OMIT this section entirely.

  Example table format (adapt columns to available data):

  Metric                        Year One          Year Two          Year Three
  ──────────────────────────────────────────────────────────────────────────────
  Projected Revenue             [if selected]     [if selected]     [if selected]
  Projected Expenses            [if selected]     [if selected]     [if selected]
  Gross Profit                  [if selected]     [if selected]     [if selected]
  Net Profit                    [if selected]     [if selected]     [if selected]
  Break Even Point              [if selected]     [if selected]     [if selected]
  Funding Required              [if selected]     —                 —

  Follow the table with one short paragraph contextualising the figures
  and what they mean for the business trajectory. No narrative invention.


RISK ANALYSIS

  Market Risk
    Risk description and mitigation strategy.

  Financial Risk
    Risk description and mitigation strategy.

  Operational Risk
    Risk description and mitigation strategy.

  Regulatory Risk
    Risk description and mitigation strategy.


GROWTH STRATEGY

  Explain the scaling roadmap covering:

    - Market expansion opportunities.
    - Product or service roadmap.
    - Strategic partnerships.
    - Technology adoption.
    - Operational scaling approach.


CONCLUSION

  A persuasive close that reinforces confidence in the business, summarises the opportunity,
  and states clear next steps for the reader.
"""
