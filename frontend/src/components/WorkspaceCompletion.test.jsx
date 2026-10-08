// Workspace profile completion: the percentage comes from the sign-up setup's fields,
// skipped defaults don't count, and the ring's colour follows the level.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkspaceCompletion from "./WorkspaceCompletion";
import { COMPLETION_FIELDS, workspaceCompletion } from "../lib/workspaceCompletion";

afterEach(cleanup);

const full = {
  company_name: "Apex Consulting Ltd", business_type: "startup", primary_industry: "consulting", tagline: "Clarity for founders",
  about_company: "We help founders plan and fund their first year.", operating_stage: "growing", company_size: "2-5",
  country: "United Kingdom", city: "London", phone_number: "020 7946 0000", website: "https://apex.example",
  services: [{ service_name: "Bookkeeping" }],
};
// What setup stores when every step is skipped.
const skippedAll = {
  workspace_profile: { company_name: "My workspace", business_type: "startup", primary_industry: "other",
    about_company: "My workspace is building its business with EnterprateAI.", services: [], country: "Not specified", city: "Not specified",
    email: "me@x.test", operating_stage: "idea", delivery_model: "manual" },
  onboarding: { skipped: true, defaulted_fields: ["company_name", "business_type", "primary_industry", "about_company", "services", "country", "city", "email", "operating_stage", "delivery_model"] },
};

describe("workspaceCompletion", () => {
  it("is 100% when every setup field is answered", () => {
    expect(workspaceCompletion({ workspace_profile: full })).toMatchObject({ percent: 100, done: 12, total: 12, missing: [], level: "complete" });
  });

  it("counts nothing for a setup that was skipped entirely: defaults are not answers", () => {
    const c = workspaceCompletion(skippedAll);
    expect(c.percent).toBe(0);
    expect(c.level).toBe("low");
    expect(c.missing).toHaveLength(COMPLETION_FIELDS.length);
  });

  it("counts a default-looking choice once the user has actually chosen it", () => {
    // "startup" / "idea" picked on purpose (not recorded as skipped) are real answers.
    const data = { workspace_profile: { ...skippedAll.workspace_profile, company_name: "Apex" }, onboarding: { defaulted_fields: ["primary_industry"] } };
    const c = workspaceCompletion(data);
    expect(c.missing).not.toContain("Business type");
    expect(c.missing).not.toContain("Stage");
    expect(c.missing).toContain("Industry");
    expect(c.percent).toBe(25);                               // name, type, stage of 12
  });

  it("moves through the levels as fields are added", () => {
    const at = (n) => workspaceCompletion({ workspace_profile: Object.fromEntries(Object.entries(full).slice(0, n)) });
    expect(at(4)).toMatchObject({ percent: 33, level: "low" });
    expect(at(5)).toMatchObject({ percent: 42, level: "medium" });
    expect(at(9)).toMatchObject({ percent: 75, level: "medium" });
    expect(at(10)).toMatchObject({ percent: 83, level: "high" });
    expect(at(11).missing).toEqual(["A product or service"]);
  });

  it("has nothing to say without a workspace", () => {
    expect(workspaceCompletion(null)).toBeNull();
    expect(workspaceCompletion({}).percent).toBe(0);
  });
});

describe("WorkspaceCompletion ring", () => {
  const show = (completion) => render(<MemoryRouter><WorkspaceCompletion completion={completion} /></MemoryRouter>);
  const ringColour = () => document.querySelectorAll("circle")[1].getAttribute("stroke");

  it("shows the percentage, says what is missing, and links to the profile", () => {
    show({ percent: 42, done: 5, total: 12, level: "medium", missing: ["Stage", "Team size", "Country", "City", "Website"] });
    expect(screen.getByText("42%")).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/account?section=workspace");
    expect(link.getAttribute("aria-label")).toBe("Workspace profile 42% complete. Still to add: Stage, Team size, Country and 2 more");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  });

  it("is red when low, amber part-way, green when nearly or fully done", () => {
    show({ percent: 17, level: "low", missing: ["x"] });
    expect(ringColour()).toBe("#e11d48");
    cleanup();
    show({ percent: 58, level: "medium", missing: ["x"] });
    expect(ringColour()).toBe("#d97706");
    cleanup();
    show({ percent: 92, level: "high", missing: ["x"] });
    expect(ringColour()).toBe("#059669");
    cleanup();
    show({ percent: 100, level: "complete", missing: [] });
    expect(ringColour()).toBe("#059669");
    expect(screen.queryByText("100%")).toBeNull();            // a tick instead of a number
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("Workspace profile 100% complete");
  });

  it("renders nothing until a workspace has been measured", () => {
    const { container } = show(null);
    expect(container.innerHTML).toBe("");
  });
});
