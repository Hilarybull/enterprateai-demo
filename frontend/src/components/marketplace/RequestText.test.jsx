import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RequestText, { requestBlocks } from "./RequestText";

const typed = `Altmosphere Consulting Ltd is inviting proposals from qualified UK accountants.
We are seeking a reliable accounting partner to support us with areas such as:
- Annual accounts preparation
- Corporation Tax filing
- VAT support (where applicable)

Ideal fit
We are looking for a provider who offers:
• Strong UK tax and accounting knowledge
• Clear communication`;

describe("a Request for Proposal's description", () => {
  it("keeps paragraphs, lists and headings as typed", () => {
    expect(requestBlocks(typed)).toEqual([
      { kind: "p", text: "Altmosphere Consulting Ltd is inviting proposals from qualified UK accountants. We are seeking a reliable accounting partner to support us with areas such as:" },
      { kind: "ul", items: ["Annual accounts preparation", "Corporation Tax filing", "VAT support (where applicable)"] },
      { kind: "h", text: "Ideal fit" },
      { kind: "h", text: "We are looking for a provider who offers:" },
      { kind: "ul", items: ["Strong UK tax and accounting knowledge", "Clear communication"] },
    ]);
  });

  it("shows a list as bullets and a plain sentence as a paragraph", () => {
    render(<RequestText text={typed} />);
    expect(screen.getAllByRole("list").length).toBe(2);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toContain("Corporation Tax filing");
    expect(screen.getByText("Ideal fit").tagName).toBe("P");
  });

  it("shows nothing for an empty description", () => {
    const { container } = render(<RequestText text="  " />);
    expect(container.innerHTML).toBe("");
  });
});
