import { describe, expect, it } from "vitest";
import { safeHtml, safeStyles } from "./safeHtml";

describe("HTML put on a page", () => {
  it("never runs a script, however it is hidden", () => {
    for (const bad of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<a href=\"javascript:alert(1)\">x</a>", "<svg onload=alert(1)></svg>", "<iframe src=\"https://evil.test\"></iframe>"]) {
      const out = safeHtml(bad);
      expect(out).not.toMatch(/<script|onerror|onload|javascript:|<iframe/i);
    }
  });

  it("keeps a document's formatting, styling, tables, images and charts", () => {
    const doc = "<style>.a > b { color: red; }</style><h1 class=\"t\" style=\"color: blue\">Plan</h1><table><tbody><tr><td colspan=\"2\">£1,000</td></tr></tbody></table><img src=\"data:image/png;base64,AAAA\" alt=\"logo\"><a href=\"https://x.test\" target=\"_blank\">Link</a><svg viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\"></rect></svg>";
    const out = safeHtml(doc);
    expect(out).toContain(".a > b { color: red; }");
    for (const kept of ["<h1 class=\"t\" style=\"color: blue\">Plan</h1>", "colspan=\"2\"", "data:image/png", "target=\"_blank\"", "<svg", "<rect"]) expect(out).toContain(kept);
  });

  it("a shared document's head keeps its styles and Google fonts, and no other stylesheet", () => {
    const out = safeStyles("<style>p { margin: 0; }</style>\n<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Inter\">\n<link rel=\"stylesheet\" href=\"https://evil.test/x.css\">");
    expect(out).toContain("p { margin: 0; }");
    expect(out).toContain("fonts.googleapis.com");
    expect(out).not.toContain("evil.test");
  });
});
