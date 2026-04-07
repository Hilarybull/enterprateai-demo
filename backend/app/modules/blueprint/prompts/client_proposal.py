CLIENT_PROPOSAL_PROMPT = """
Write a complete, submission-ready UK Client Proposal on behalf of {company_name}, addressed to {client_name}.
This is a client-facing proposal — not a business plan and not a sales letter.

INPUTS (some may be brief or blank — infer intelligently from context and industry norms):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order given. Do not add, remove, or rename headings.
- Write every section as finished, decision-ready content — no skeletons, no placeholders, no "TBD", no "N/A".
- Do NOT fabricate financial amounts, prices, percentages, VAT rates, or dates. Use only what is supplied in inputs.
- If a numeric value is missing, write around it in narrative form without inventing a figure.
- Do NOT copy input phrases verbatim. Always paraphrase and expand into professional narrative.
- Do NOT repeat the same idea across sections. Each section must add new, distinct value.
- Minimum two full paragraphs per section. Bullet points may supplement but never replace prose.
- Each section should be detailed enough to stand alone as a mini report.
- If a field is blank or insufficient, infer from industry context and write it as natural, confident narrative.
- Do NOT use unnecessary hyphens in the generated document. Write compound words and phrases as
  separate words unless the hyphen is grammatically required (e.g. well established, up to date).

STYLE:
- Formal, professional British English throughout.
- Short paragraphs, clear headings, bullet points where appropriate.
- Specific to {company_name}, {client_name}, their industry, and the UK market context.
- The proposal must feel genuinely written for {client_name}, not generic.
- The full document should be comprehensive and multi-page (aim for at least ten pages when all sections are included).

OUTPUT FORMAT:
- Valid Markdown only.
- Use # for the main title, ## for main sections, ### for sub sections.
- Use hyphen bullets for lists.
- After the Cover Page block, insert a page break using: <div class="page-break"></div>

---

On the Cover Page, use the proposal title format: "Proposal for {client_name}" unless a different title is explicitly provided.

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
Credibility: experience, expertise, relevant work, certifications or accreditations in principle, and key team members.

## Terms and Conditions
Summarise liability, confidentiality, cancellation terms, and intellectual property.

## Acceptance / Call to Action
Clear next steps for approval and onboarding, with contact details.
"""
