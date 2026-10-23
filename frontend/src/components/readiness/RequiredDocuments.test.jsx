import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RequiredDocuments } from "./Panels";

afterEach(cleanup);

// Synthetic: the case's own spending lines and forecast as documents, and one document not provided yet
const subject = {
  id: "c1", status: "active", can: { "funding.review": true, "funding.edit": true },
  profile_definition: { required_documents: [
    { key: "exec", label: "Executive summary or equivalent pitch content" },
    { key: "uof", label: "Use-of-funds schedule", record: "use_of_funds" },
    { key: "fc", label: "Monthly forecast", record: "forecast" }] },
  data: { currency: "NGN", documents: {}, use_of_funds: [{ id: "a1", category: "Marketing", amount: "400000", purpose: "Flyers and radio" }, { id: "a2", category: "Reserve", amount: "100000" }] },
  forecast: { data: { opening_cash: "300000", months: [{ month: "2026-11", receipts: "120000", payments: "" }] } },
  evidence: [],
};

it("shows what is being reviewed, and offers no review of a document not provided", () => {
  render(<RequiredDocuments businessId="b1" subject={subject} onChanged={() => {}} />);
  const rows = [...document.querySelectorAll("li")];
  expect(rows[0].querySelector("[data-document-toggle]")).toBeNull();
  expect([...rows[0].querySelectorAll("button")].find((b) => b.textContent === "Mark as reviewed").disabled).toBe(true);
  fireEvent.click(rows[1].querySelector("[data-document-toggle]"));
  const uof = rows[1].querySelector("[data-document-view]").textContent;
  expect(uof).toContain("Marketing");
  expect(uof).toContain("Flyers and radio");
  expect(uof).toMatch(/Total.*500,000/);
  fireEvent.click(rows[2].querySelector("[data-document-toggle]"));
  const fc = rows[2].querySelector("[data-document-view]").textContent;
  expect(fc).toContain("Opening cash");
  expect(fc).toContain("Not filled");
  expect([...rows[1].querySelectorAll("button")].find((b) => b.textContent === "Mark as reviewed").disabled).toBe(false);
});
