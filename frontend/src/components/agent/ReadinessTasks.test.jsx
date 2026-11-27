import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiRequest } from "../../api/client";
import ReadinessTasks from "./ReadinessTasks";
import FundingOptions from "./FundingOptions";
vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));
beforeEach(()=>{apiRequest.mockResolvedValue({});});
afterEach(() => { cleanup(); apiRequest.mockReset(); });
const subject = { revision: 7, data: { purpose: "Equipment", agent_drafts: {} }, profile_definition: { sections: [
  { key: "goal", fields: [{ key: "purpose", label: "What is the funding for?", type: "textarea" }] }] } };
const item = { case_id: "case", topic: "funding", title: "Your remaining funding items", items: [{ title: "Confirm your funding purpose", section: "goal" }], drafts: [] };
const click = async name => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

test("Each pending item offers manual fields and saves their values to the correct case", async () => {
  apiRequest.mockImplementation(async (path, method) => method === "PATCH" ? subject : /readiness-items/.test(path) ? { ...item, items: [] }
    : { ...subject, actions: [{ title: item.items[0].title, section: "goal" }] });
  const updated = vi.fn(), send = vi.fn();
  render(<ReadinessTasks item={{ ...item, items: [{ title: item.items[0].title }] }} businessId="business" onUpdated={updated} onSend={send} />);
  expect(screen.getByRole("button", { name: "Help me fill this" })).toBeTruthy();
  await click("I’ll fill it myself");
  const input = screen.getByLabelText("What is the funding for?");
  expect(input.value).toBe("Equipment");
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(input, { target: { value: "Staff salaries" } });
  await click("Save changes");
  expect(apiRequest).toHaveBeenCalledWith("/businesses/business/funding-cases/case", "PATCH", { revision: 7, changes: { purpose: "Staff salaries", agent_drafts: {} } });
  expect(updated).toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("editing a draft saves it for review without approving it", async () => {
  const draftSubject = { ...subject, data: { ...subject.data, agent_drafts: { purpose: { value: "New equipment", source: "Suggested by the agent" } } } };
  apiRequest.mockImplementation(async path => /readiness-items/.test(path) ? item : draftSubject);
  render(<ReadinessTasks item={{ ...item, drafts: [{ label: "Purpose", value: "New equipment" }] }} businessId="business" onUpdated={vi.fn()} onSend={vi.fn()} />);
  await click("Review");
  await click("Edit");
  await click("I’ll edit it myself");
  fireEvent.change(screen.getByLabelText("What is the funding for?"), { target: { value: "Replacement laptops" } });
  await click("Save changes");
  const patch = apiRequest.mock.calls.find(call => call[1] === "PATCH")[2];
  expect(patch.changes.purpose).toBeUndefined();
  expect(patch.changes.agent_drafts.purpose.value).toBe("Replacement laptops");
  expect(apiRequest.mock.calls.some(call => /assessments/.test(call[0]))).toBe(false);
});

test("agent drafting remains in chat and requests review before approval", async () => {
  const send = vi.fn();
  render(<ReadinessTasks item={item} businessId="business" onUpdated={vi.fn()} onSend={send} />);
  await click("Help me fill this");
  expect(send.mock.calls[0][0]).toContain("Confirm your funding purpose");
  expect(send.mock.calls[0][0]).toContain("Show any proposed changes for review");
  expect(send.mock.calls[0][1].readinessItem.case_id).toBe("case");
});

test("agent work includes the actual conflict and stays visibly busy until the reply arrives", async () => {
  let finish;
  const send = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const selected = { title: "Review the forecast", section: "documents", detail: "The forecast is in GBP and the case is in NGN." };
  render(<ReadinessTasks item={{ ...item, items: [selected] }} businessId="business" onUpdated={vi.fn()} onSend={send} />);
  await click("Help me fill this");
  expect(send.mock.calls[0][0]).toContain(selected.detail);
  expect(send.mock.calls[0][1].readinessItem).toMatchObject({ case_id: "case", section: "documents", detail: selected.detail });
  expect(screen.getByText("Working on this item…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Help me fill this" }).disabled).toBe(true);
  await act(async () => { finish(); });
  expect(screen.queryByText("Working on this item…")).toBeNull();
});

test("document review opens documents and saves the review instead of showing risk fields", async () => {
  const step = { title: "Provide and review the preparation documents", code: "C8.A", review: "documents", section: "documents", has_values: true, values: [{label:"Business plan",value:"Document attached"}] };
  const live = { ...subject, id: "case", can: { "funding.review": true }, actions: [{ ...step, status: "open" }],
    data: { documents: { business_plan: { artifact_id: "document" } } },
    profile_definition: { ...subject.profile_definition, required_documents: [{ key: "business_plan", label: "Business plan" }] } };
  apiRequest.mockImplementation(async path => /readiness-items/.test(path) ? item : live);
  const updated = vi.fn();
  render(<ReadinessTasks item={{ ...item, items: [step] }} businessId="business" onUpdated={updated} onSend={vi.fn()} />);
  await click("Review"); await click("Edit"); await click("I’ll edit it myself");
  expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
  await click("Mark as reviewed");
  expect(apiRequest).toHaveBeenCalledWith("/businesses/business/funding-cases/case/documents/business_plan", "POST", { reviewed: true });
  await waitFor(() => expect(updated).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

test("reviewer tasks open the reviewer confirmation form", async () => {
  const step = { title: "Confirm the evidence is relevant", code: "C4.B", review: "attestation", section: "validation", has_values: true, values: [{label:"Customer evidence",value:"Interview notes"}] };
  const live = { ...subject, id: "case", can: { "funding.review": true }, actions: [step], evidence: [],
    profile_definition: { sections: [{ key: "validation", fields: [], attest: ["C4.B"], evidence: ["C4.A"] }],
      criteria: [{ checks: [{ code: "C4.B", label: "Evidence relevance" }] }] } };
  apiRequest.mockResolvedValue(live);
  render(<ReadinessTasks item={{ ...item, items: [step] }} businessId="business" onUpdated={vi.fn()} onSend={vi.fn()} />);
  await click("Review"); await click("Edit"); await click("I’ll edit it myself");
  await click("Review this");
  expect(screen.getByRole("button", { name: "Confirm it is in place" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Record that it is not in place" })).toBeTruthy();
});

test("funding sources have their own results UI and do not show draft controls", () => {
  render(<FundingOptions item={{ routes: ["loan"], options: [{ title: "Working Capital Loan", route: "loan", text: "Funding for working capital", url: "https://lender.example.test/loan" }] }} />);
  expect(screen.getByText("Working Capital Loan")).toBeTruthy();
  expect(screen.getByRole("link", { name: /View funding source/ }).href).toBe("https://lender.example.test/loan");
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
});

test.each([["Approve", true], ["Reject", false]])("%s saves the user's decision and removes the pending draft", async (action, approved) => {
  const saved = { ...subject, data: { ...subject.data, agent_drafts: { purpose: { value: "Payroll" } } } };
  apiRequest.mockImplementation(async path => /readiness-items/.test(path) ? item : saved);
  render(<ReadinessTasks item={{ ...item, drafts: [{ path: "purpose", label: "Funding purpose", value: "Payroll" }] }} businessId="business" onUpdated={vi.fn()} onSend={vi.fn()} />);
  await click(action);
  const changes = apiRequest.mock.calls.find(call => call[1] === "PATCH")[2].changes;
  expect(changes.agent_drafts).toEqual({});
  if (approved) expect(changes.purpose).toBe("Payroll");
  else { expect(changes.purpose).toBeUndefined(); expect(changes.rejected_drafts).toContain("purpose"); }
});


test.each(["funding","launch"])("%s populated items review first, then offer an editing choice", async topic=>{
  const populated={...item,revision:7,topic,items:[{code:"C1.A",title:"Confirm the goal",section:"goal",has_values:true,values:[{path:"purpose",label:"Purpose",value:"Equipment"}]}]};
  apiRequest.mockResolvedValue(subject);
  render(<ReadinessTasks item={populated} businessId="business" onUpdated={vi.fn()} onSend={vi.fn()}/>);
  expect(screen.getByRole("button",{name:"Approve"})).toBeTruthy();expect(screen.getByRole("button",{name:"Reject"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Help me fill this"})).toBeNull();expect(screen.queryByLabelText("What is the funding for?")).toBeNull();
  await click("Review");expect(screen.getByLabelText("Review values").textContent).toContain("Equipment");
  expect(apiRequest.mock.calls.every(call=>call[1]===undefined)).toBe(true);await click("Edit");
  expect(screen.getByRole("button",{name:"Help me edit this"})).toBeTruthy();await click("I’ll edit it myself");
  expect(screen.getByLabelText("What is the funding for?").value).toBe("Equipment");expect(screen.queryByRole("alert")).toBeNull();
});

test.each(["documents","attestation","evidence","forecast"])("empty %s checks offer filling and never review or approve",review=>{
  render(<ReadinessTasks item={{...item,revision:7,items:[{title:"Missing evidence",review,has_values:false,values:[]}]}} businessId="business" onSend={vi.fn()}/>);
  expect(screen.getByRole("button",{name:"Help me fill this"})).toBeTruthy();expect(screen.getByRole("button",{name:"I’ll fill it myself"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Review"})).toBeNull();expect(screen.queryByRole("button",{name:"Approve"})).toBeNull();
});

test("previously saved incorrect review buttons refresh even when the case revision is unchanged", async()=>{
  const stale={...item,type:"readiness_tasks",revision:7,items:[{code:"C4.A",title:"Attach evidence",has_values:true,values:[{label:"Summary",value:"No traction yet"}]}]};
  apiRequest.mockResolvedValue({...stale,items:[{...stale.items[0],has_values:false,values:[]}]});
  render(<ReadinessTasks item={stale} businessId="business" onSend={vi.fn()}/>);
  await screen.findByRole("button",{name:"Help me fill this"});
  expect(screen.queryByRole("button",{name:"Review"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Approve"})).toBeNull();
});

test.each([["Approve",true],["Reject",false]])("%s applies only the selected populated item with its version",async(label,approve)=>{
  const filled={...item,revision:7,items:[{code:"C1.A",title:"Confirm the goal",has_values:true,values:[{path:"purpose",label:"Purpose",value:"Equipment"}]}]};
  apiRequest.mockResolvedValue({card:{...filled,type:"readiness_tasks",revision:8,items:[]},message:"Decision saved"});
  render(<ReadinessTasks item={filled} businessId="business" onUpdated={vi.fn()} onSend={vi.fn()}/>);await click(label);
  expect(apiRequest).toHaveBeenCalledWith("/businesses/business/agent/readiness-items/funding/case/decision","POST",{code:"C1.A",revision:7,approve});
  expect(screen.getByRole("status").textContent).toBe("Decision saved");
});
