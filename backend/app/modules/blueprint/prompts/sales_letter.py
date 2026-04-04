SALES_LETTER_PROMPT = """
Write a complete, client ready UK Sales Letter for {client_name}.
This is a sales letter — not a proposal and not a business plan.

INPUTS (some may be brief or blank — infer intelligently from context and industry norms):
{formatted_inputs}

STRICT REQUIREMENTS:
- Write a finished letter — no skeletons, no placeholders, no "TBD", no "N/A".
- Follow the structure in the exact order given. Do not add, remove, or reorder elements.
- Do NOT fabricate financial amounts, prices, discounts, or dates. Use only what is supplied in inputs.
- If a numeric value is missing, write around it in narrative form without inventing a figure.
- Do NOT copy input phrases verbatim. Always paraphrase and expand into professional narrative.
- Do NOT repeat the same idea across sections. Each element must add new value and momentum.
- The letter must feel genuine and personally written for {client_name} — not a template or checklist.
- If a field is blank or insufficient, infer from industry context and write it as natural, confident narrative.
- Do NOT use unnecessary hyphens in the generated document. Write compound words and phrases as
  separate words unless the hyphen is grammatically required (e.g. well-established, up-to-date).

STYLE:
- Formal yet warm, professional British English throughout.
- Confident, persuasive, and direct — every sentence must earn its place.
- Short paragraphs, no bullet points except in the Benefits element.
- Specific to {client_name}, their industry, and the UK market context.

OUTPUT FORMAT:
Plain text, well formatted and consistently aligned — no Markdown symbols, no hashtags, no asterisks.
Use indentation and line spacing to create visual structure and readability.
Write the letter as continuous prose with the elements flowing naturally into one another.
Do not label the elements with headings — they must read as a single, seamless letter.

---

  [Sender Company Name]
  [Sender Address Line 1]
  [Sender Address Line 2]
  [City, Postcode]
  [Email Address]
  [Phone Number]

  [Date — written in full, e.g. 4th April 2026]

  [Recipient Name]
  [Recipient Job Title]
  [Recipient Company Name]
  [Recipient Address]
  [City, Postcode]


  Dear [Recipient Name],


  [BOLD HEADLINE — one punchy, benefit led sentence that immediately captures attention.
  Write it in ALL CAPS to simulate bold in plain text.]


  Opening / Hook
  Write one to two short paragraphs that immediately draw {client_name} in. Acknowledge
  their world, their pressures, or a timely opportunity relevant to them. Make it feel
  like this letter was written specifically for them.


  Problem Statement
  Write one to two paragraphs that articulate the specific problem or gap {client_name}
  is likely facing. Be precise and empathetic. Make them feel understood, not lectured.


  Solution Introduction
  Write one to two paragraphs introducing the solution. Explain what it is, how it works
  at a high level, and why it is the right fit for {client_name}'s situation.


  Benefits
  Introduce the benefits with a short lead in sentence, then present them as a clean,
  indented bullet list. Each bullet must be outcome focused — not a feature list.

    - [Benefit one — outcome focused]
    - [Benefit two — outcome focused]
    - [Benefit three — outcome focused]
    - [Benefit four — outcome focused, if applicable]

  Follow the bullets with one short paragraph that reinforces the overall impact.


  Proof / Credibility
  Write one to two paragraphs establishing trust. Reference relevant experience, expertise,
  or results in principle — without fabricating specific metrics or client names unless
  supplied in the inputs.


  Offer
  Write one natural, confident sentence or short paragraph presenting the offer.
  Do not label it. It must flow directly from the credibility above.
  Include figures only if supplied in the inputs.


  Call to Action
  Write one clear, direct sentence telling {client_name} exactly what to do next.
  Make it easy and low friction. Do not label it.


  Urgency / Scarcity
  Write one sentence that creates a genuine sense of timeliness or limited availability.
  Do not fabricate deadlines or quantities — infer naturally from context if not supplied.


  Closing
  Write a warm, confident closing paragraph that leaves {client_name} feeling positive
  and compelled to act. Then close the letter formally.


  Yours sincerely,


  [Sender Full Name]
  [Sender Job Title]
  [Sender Company Name]
  [Phone Number]
  [Email Address]
  [Website, if applicable]
"""
