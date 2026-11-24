// The owner, 26 Oct: the pack strip said "2 of 2" while the pack listed the executive and team summaries still to do: a loan
// or a grant isn't asked for the equity-only items, here as in the check and the strip.
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { RequiredDocuments } from "./Panels";

afterEach(cleanup);
const docs = [{ key: "use_of_funds", label: "Use of funds" }, { key: "executive_summary", label: "Executive summary or equivalent pitch content" },
  { key: "team_summary", label: "Team and ownership summary" }];
const subject = (route) => ({ id: "c1", can: {}, profile_definition: { required_documents: docs }, data: { route_preference: route, documents: {} }, assessment: { result: { documents: [] } } });

it("a loan or a grant leaves the equity-only items out", () => {
  render(<MemoryRouter><RequiredDocuments businessId="b1" subject={subject("loan")} onChanged={() => {}} /></MemoryRouter>);
  expect(screen.queryByText(/Executive summary or equivalent pitch content/)).toBeNull();
  expect(screen.queryByText(/Team and ownership summary/)).toBeNull();
});

it("equity asks for them", () => {
  render(<MemoryRouter><RequiredDocuments businessId="b1" subject={subject("equity")} onChanged={() => {}} /></MemoryRouter>);
  expect(screen.getAllByText(/Executive summary or equivalent pitch content/).length).toBeGreaterThan(0);
});
