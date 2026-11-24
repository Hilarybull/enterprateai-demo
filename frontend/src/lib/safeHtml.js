import DOMPurify from "dompurify";

// Everything put on a page as HTML goes through here: formatting stays, anything that could run a script doesn't.
// Documents carry their own styling (a template's <style>, inline styles, charts as SVG).
export function safeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ""), { ADD_TAGS: ["style"], ADD_ATTR: ["target"], FORCE_BODY: true });
}

const FONT_SHEET = /<link\b[^>]*\bhref=["']https:\/\/fonts\.googleapis\.com\/[^"'<>]*["'][^>]*>/gi;

/** A shared document's head: its own styles, and web fonts from Google only. No other outside stylesheet is loaded. */
export function safeStyles(html) {
  const fonts = String(html ?? "").match(FONT_SHEET) || [];
  const clean = fonts.map((tag) => DOMPurify.sanitize(tag, { ALLOWED_TAGS: ["link"], ALLOWED_ATTR: ["rel", "href"], FORCE_BODY: true }));
  return [...clean, safeHtml(String(html ?? "").replace(/<link\b[^>]*>/gi, ""))].join("\n");
}
