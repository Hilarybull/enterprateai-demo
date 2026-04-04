CLIENT_PROPOSAL_PROMPT = """
Write a complete, submission-ready UK Client Proposal on behalf of {company_name}, addressed to {client_name}.
This is a client facing proposal — not a business plan and not a sales letter.

INPUTS (some may be brief or blank — infer intelligently from context and industry norms):
{formatted_inputs}

STRICT REQUIREMENTS:
- Follow the headings in the exact order given. Do not add, remove, or rename headings.
- Write every section as finished, decision ready content — no skeletons, no placeholders, no "TBD", no "N/A".
- Do NOT fabricate financial amounts, prices, percentages, VAT rates, or dates. Use only what is supplied in inputs.
- If a numeric value is missing, write around it in narrative form without inventing a figure.
- Do NOT copy input phrases verbatim. Always paraphrase and expand into professional narrative.
- Do NOT repeat the same idea across sections. Each section must add new, distinct value.
- Minimum one full paragraph per section. Bullet points may supplement but never replace prose.
- If a field is blank or insufficient, infer from industry context and write it as natural, confident narrative.
- Do NOT use unnecessary hyphens in the generated document. Write compound words and phrases as
  separate words unless the hyphen is grammatically required (e.g. well-established, up-to-date).

STYLE:
- Formal, professional British English throughout.
- Short paragraphs, clear headings, bullet points where appropriate.
- Specific to {company_name}, {client_name}, their industry, and the UK market context.
- The proposal must feel genuinely written for {client_name} — not generic.

OUTPUT FORMAT:
Plain text, well formatted and consistently aligned — no Markdown symbols, no hashtags, no asterisks.
Use ALL CAPS for main section headings.
Use Title Case for sub headings.
Use indentation and line spacing to create visual structure and readability.
After the Cover Page block, insert a page break using: <div class="page-break"></div>

---

CLIENT PROPOSAL — {company_name}


COVER PAGE

  Proposal Title    : [Title of Engagement]
  Prepared For      : {client_name}
  Prepared By       : {company_name}
  Contact Details   : [Written out in full — address, email, phone]

<div class="page-break"></div>


EXECUTIVE SUMMARY

  A concise, persuasive overview covering the client's core need or challenge,
  the proposed solution at a high level, the key benefits {client_name} will gain,
  and why {company_name} is the right partner for this engagement.

  Write as confident, flowing prose. This section sets the tone for the entire proposal.


UNDERSTANDING OF CLIENT NEEDS

  Demonstrate a thorough understanding of {client_name}'s situation, covering:

    - Their current situation and context.
    - The specific pain points and challenges they are facing.
    - Their objectives and what success looks like for them.
    - Any constraints, sensitivities, or priorities to be aware of.

  This section must feel researched and specific — not generic.


PROPOSED SOLUTION

  Describe the solution {company_name} is bringing to the table, covering:

    - The overall approach and methodology.
    - The key services or components included.
    - How the solution directly addresses {client_name}'s needs.
    - What makes this approach distinctly effective.


SCOPE OF WORK

  Clearly define the boundaries of the engagement, covering:

    - The specific tasks and activities included.
    - What is explicitly excluded to prevent scope creep.
    - Assumptions the proposal is built upon.
    - Dependencies or responsibilities on {client_name}'s side.


IMPLEMENTATION PLAN / TIMELINE

  Provide a short phased table with timelines written in days.
  Use plain text table alignment — no Markdown table syntax.

  Phase                   Activities                          Timeline
  ─────────────────────────────────────────────────────────────────────
  Phase One               [Key activities]                    Day One to Day X
  Phase Two               [Key activities]                    Day X to Day X
  Phase Three             [Key activities]                    Day X to Day X

  Follow the table with a brief narrative explaining the sequencing logic.


PRICING AND PAYMENT TERMS

  Explain in narrative form:

    - The pricing model and structure in principle (no fabricated figures).
    - Payment schedule approach (e.g. milestone based, monthly).
    - VAT handling in principle.
    - Any assumptions about currency, invoicing, or payment terms.


VALUE PROPOSITION / BENEFITS

  Focus on outcomes and impact for {client_name}, covering:

    - Tangible business benefits and efficiency gains.
    - Competitive advantage or market positioning improvements.
    - Risk reduction or compliance benefits.
    - Long term value beyond the immediate engagement.

  Do not repeat solution details from earlier sections — focus purely on client outcomes.


COMPANY INFORMATION

  Establish {company_name}'s credibility, covering:

    - Relevant experience and expertise in this type of engagement.
    - Relevant past work or client outcomes (without fabricating specifics).
    - Certifications, accreditations, or memberships in principle.
    - Key team members and their relevance to this proposal.


TERMS AND CONDITIONS

  Summarise the key legal and commercial terms, covering:

    - Liability limitations.
    - Confidentiality and data protection obligations (including UK GDPR compliance).
    - Cancellation and termination terms.
    - Intellectual property ownership.

  Write as clear, plain English narrative — not dense legal text.


ACCEPTANCE / CALL TO ACTION

  Close with clear, confident next steps, covering:

    - How {client_name} can formally accept the proposal.
    - The onboarding process once accepted.
    - Key contacts at {company_name} for questions or clarifications.
    - Any deadline or timeframe for the proposal's validity.
"""