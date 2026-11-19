import React from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TenderEvaluation from "./TenderEvaluation";
import { submitAgentRequest } from "../../lib/agent";
vi.mock("../../lib/agent",()=>({submitAgentRequest:vi.fn()}));
vi.mock("../../store/workspace",()=>({ensureWorkspaceId:vi.fn(async()=>"A"),useWorkspaceStore:{getState:()=>({workspaceId:"A"})}}));
beforeEach(()=>{cleanup();vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();});
const renderPanel=(token="fixture",workspaceId="A")=>render(<MemoryRouter><TenderEvaluation notice={{id:"notice-1"}} token={token} workspaceId={workspaceId}/></MemoryRouter>);
test("evaluates the selected business through Procurement and gives next steps",async()=>{
 submitAgentRequest.mockResolvedValue({procurement:{tender_evaluation:{notice_id:"notice-1",workspace_id:"A",business_name:"Example",verdict:"More information needed",overview:[{heading:"How to respond",explanation:"Submit an insurance certificate with your offer.",evidence:[{source:"eligibility",quote:"Insurance required"}]}],findings:[{requirement:"Insurance",alignment:"unknown",explanation:"No insurance evidence is recorded.",tender_evidence:[{source:"eligibility",quote:"Insurance required"}],business_evidence:[],next_step:"Gather your insurance certificate and confirm the cover."}],limitations:[]}}});
 renderPanel();fireEvent.click(screen.getByRole("button",{name:"Evaluate This Tender for Me"}));
 await waitFor(()=>expect(screen.getByRole("heading",{name:"What to do next"})).toBeTruthy());
 expect(screen.getByText("Gather your insurance certificate and confirm the cover.")).toBeTruthy();
 expect(screen.getByRole("heading",{name:"Tender explained"})).toBeTruthy();
 expect(screen.getByText("Submit an insurance certificate with your offer.")).toBeTruthy();
 expect(submitAgentRequest.mock.calls[0][0]).toMatchObject({businessId:"A",page:"procurement",params:{action:"tender_evaluation",tender_id:"notice-1"}});
});
test("public visitors sign in before evaluation",()=>{
 renderPanel(null);expect(screen.getByRole("link",{name:"Evaluate This Tender for Me"}).getAttribute("href")).toContain("/login?next=");expect(submitAgentRequest).not.toHaveBeenCalled();
});
test("failed generation leaves the tender usable and offers retry",async()=>{
 submitAgentRequest.mockRejectedValue(new Error("HTTP 503"));renderPanel();fireEvent.click(screen.getByRole("button",{name:"Evaluate This Tender for Me"}));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Please try again"));expect(screen.queryByText("HTTP 503")).toBeNull();expect(screen.getByRole("button",{name:"Evaluate This Tender for Me"}).disabled).toBe(false);
});

test("resolves an existing workspace when a tender was opened directly",async()=>{
 submitAgentRequest.mockResolvedValue({procurement:{tender_evaluation:{notice_id:"notice-1",workspace_id:"A",business_name:"Example",verdict:"More information needed",findings:[],limitations:[]}}});
 renderPanel("fixture",null);fireEvent.click(screen.getByRole("button",{name:"Evaluate This Tender for Me"}));
 await waitFor(()=>expect(submitAgentRequest).toHaveBeenCalled());expect(submitAgentRequest.mock.calls[0][0].businessId).toBe("A");
});
