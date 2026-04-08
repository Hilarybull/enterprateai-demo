BUSINESS_PLAN_PROMPT = """
Write a complete, submission-ready Business Plan for {company_name}, strictly following the outline below.
This is a formal business plan — not a proposal, not a sales letter.

INPUTS (some may be brief or blank — infer intelligently from context and industry norms):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order given. Do not add, remove, or rename headings.
- Write every section as finished, decision-ready content — no skeletons, no placeholders, no "TBD", no "N/A".
- Do NOT fabricate financial amounts, prices, percentages, projections, or dates. Use only what is supplied in inputs.
- If a numeric value is missing, write around it in narrative form without inventing a figure.
- Do NOT copy input phrases verbatim. Always paraphrase and expand into professional narrative.
- Do NOT repeat the same idea across sections. Each section must add new, distinct value.
- Minimum two full paragraphs per sub section. Bullet points may supplement but never replace prose.
- Each main section should read as a mini report: detailed, specific, and multi paragraph.
- If a field is blank or insufficient, infer from industry context and write it as natural, confident narrative.
- Do NOT use unnecessary hyphens in the generated document. Write compound words and phrases as separate words unless the hyphen is grammatically required (e.g. well established, up to date).

STYLE:
- Formal, professional British English throughout.
- Short paragraphs, clear headings, bullet points where appropriate.
- Specific to {company_name}, its industry, and the UK market context.
- The full document should be comprehensive and multi-page (aim for at least ten - fifteen pages (500 words per page) when all sections are included).

OUTPUT FORMAT:
- Valid Markdown only.
- Use # for the main title, ## for main sections, ### for sub sections.
- Use hyphen bullets for lists.

---

## Executive Summary
Write several strong paragraphs covering:
- What the business does (one clear sentence).
- Why it will succeed in the UK market (minimum one full contextual paragraph — never vague).
- If funding is relevant, explain what it is for in words only. If bootstrapped, explain the approach.

Do NOT use label prefixes such as "The Mission:", "The Hook:", or "The Request:".
These must read as natural paragraphs, not labelled statements.

End with a short bullet recap of the key highlights.

## Business Overview
### Business Model
How the business generates revenue in principle (no figures).

### Legal Structure (UK)
Recommended structure and rationale (e.g. sole trader, limited company).

### Registration (UK)
Readiness for Companies House registration and VAT considerations in principle.

### Location
Where the business operates and why that location makes strategic sense.

## Market Analysis
### Target Audience
A detailed UK customer avatar — who they are, their behaviours, spending mindset, and buying triggers.

### Competitor Analysis
Identify competitor types and provide a SWOT style view of the competitive landscape.

### Market Trends
UK specific trends, timing factors, and why now is the right moment.

## Products and Services
### The Problem
The specific customer pain point, its consequences, and why it matters now.

### The Solution
What is delivered, how it works, and what makes it distinctly different.

### Pricing Strategy
Packaging and pricing approach in words, including VAT handling in principle (no figures).

## Sales and Marketing
### Branding
Positioning, trust signals, and tone of voice.

### Channels
Where the business sells and how customers discover it.

### Marketing Strategy
A practical go to market plan with early validation activities.

## Operational Plan
### Suppliers
Sourcing strategy, partner reliability, and quality control approach.

### Technology
Tools and systems used to run the business, with UK compliance considerations where relevant.

### Insurance
Appropriate UK insurance posture in principle (e.g. public liability, professional indemnity).

## Management and Personnel
### The Team
Roles, responsibilities, and execution capability.

### Hiring Plan
Approach to contractors vs employees, and UK compliance considerations in principle (e.g. IR35, PAYE).

## Financial Plan
### Sales Forecast
Narrative forecast and the assumptions that underpin it. No invented figures.

### Cash Flow Statement
Narrative view of expected inflows, outflows, and liquidity management approach.

### Break Even Analysis
Narrative path to break even and the key levers that drive profitability.

## Risk Analysis
### Market Risk
Risk description and mitigation strategy.

### Financial Risk
Risk description and mitigation strategy.

### Operational Risk
Risk description and mitigation strategy.

### Regulatory Risk
Risk description and mitigation strategy.

## Growth Strategy
Explain the scaling roadmap covering:
- Market expansion opportunities.
- Product or service roadmap.
- Strategic partnerships.
- Technology adoption.
- Operational scaling approach.

## Conclusion
A persuasive close that reinforces confidence in the business, summarises the opportunity,
and states clear next steps for the reader.
"""
