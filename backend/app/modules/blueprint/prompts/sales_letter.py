SALES_LETTER_PROMPT = """
Write a complete UK-style Sales Letter for {company_name} that reads like a real letter a business would send to a client.

INPUTS (some may be brief or blank — infer intelligently from context):
{formatted_inputs}

STRICT REQUIREMENTS:
- Write a finished letter — no placeholders.
- Do NOT fabricate prices, discounts, dates, or numeric claims. Use only supplied figures.
- Do NOT copy input phrases verbatim. Always paraphrase and expand into professional narrative.
- Avoid repetition across elements; each line must add new value.
- Use the provided date line exactly; do not add a "Date:" prefix.
- Include a subject line after the greeting, written in uppercase and **bold**.
- If a follow-up sequence is provided, include a short paragraph that summarises it in one or two sentences.
- Use the provided client name in the recipient block and greeting.
- Keep the overall word count close to the provided target word count.

STYLE:
- Warm, persuasive, and direct.
- Short paragraphs that read naturally in a letter format.

OUTPUT FORMAT:
- Valid Markdown only.
- Do NOT add extra headings beyond the required letter structure.
- Use **bold** for the subject line only.
- Use bullet points only for the benefits section.

---

Write only the letter itself (no extra headings beyond the cover page).
Include a date line, greeting, subject line, and sign-off.
The letter should be continuous prose with short paragraphs and a confident, friendly tone.
Include, in order, the following elements inside the letter body (do not label them with extra headings):
- A bold, uppercase subject line after the greeting.
- Problem statement.
- Solution introduction.
- Benefits as bullet points.
- Proof / credibility.
- Offer written as a natural sentence (no label).
- Clear call to action written as a sentence (no label).
- Urgency / scarcity written as a sentence (no label).
- Closing and sign-off with sender details.
"""
