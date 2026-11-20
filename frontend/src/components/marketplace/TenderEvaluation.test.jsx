import React from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TenderEvaluation from "./TenderEvaluation";
import { submitAgentRequest } from "../../lib/agent";
import { apiRequest } from "../../api/client";
vi.mock("../../api/client",()=>({apiRequest:vi.fn()}));
vi.mock("../../lib/agent",()=>({submitAgentRequest:vi.fn()}));
vi.mock("../../store/workspace",()=>({ensureWorkspaceId:vi.fn(async()=>"A"),useWorkspaceStore:{getState:()=>({workspaceId:"A"})}}));
beforeEach(()=>{cleanup();vi.clearAllMocks();apiRequest.mockResolvedValue({evaluation:null});Element.prototype.scrollIntoView=vi.fn();});
const renderPanel=(token="fixture",workspaceId="A")=>render(<MemoryRouter><TenderEvaluation notice={{id:"notice-1"}} token={token} workspaceId={workspaceId}/></MemoryRouter>);
test("evaluates the selected business through Procurement and gives next steps",async()=>{
 submitAgentRequest.mockResolvedValue({procurement:{tender_evaluation:{notice_id:"notice-1",workspace_id:"A",business_name:"Example",verdict:"More information needed",overview:[{heading:"How to respond",explanation:"Submit an insurance certificate with your offer.",evidence:[{source:"eligibility",quote:"Insurance required"}]}],findings:[{requirement:"Insurance",alignment:"unknown",explanation:"No insurance evidence is recorded.",tender_evidence:[{source:"eligibility",quote:"Insurance required"}],business_evidence:[],next_step:"Gather your insurance certificate and confirm the cover."}],limitations:[]}}});
 renderPanel();fireEvent.click(await screen.findByRole("button",{name:"Evaluate This Tender for Me"}));
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
 submitAgentRequest.mockRejectedValue(new Error("HTTP 503"));renderPanel();fireEvent.click(await screen.findByRole("button",{name:"Evaluate This Tender for Me"}));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Please try again"));expect(screen.queryByText("HTTP 503")).toBeNull();expect(screen.getByRole("button",{name:"Evaluate This Tender for Me"}).disabled).toBe(false);
});

test("opens a saved evaluation in a popup without generating it again",async()=>{
 apiRequest.mockResolvedValue({evaluation:{notice_id:"notice-1",workspace_id:"A",business_name:"Example",verdict:"Saved review",findings:[],limitations:[]},stale:false});
 renderPanel();fireEvent.click(await screen.findByRole("button",{name:"View saved evaluation"}));
 expect(screen.getByRole("dialog",{name:"Your tender evaluation"})).toBeTruthy();
 expect(screen.getByText("Saved review")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Close popup"}));
 expect(screen.queryByRole("dialog")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"View saved evaluation"}));
 expect(screen.getByRole("dialog")).toBeTruthy();
 expect(submitAgentRequest).not.toHaveBeenCalled();
});

test("shows readable evidence labels and values while preserving saved source references",async()=>{
 const saved = {notice_id:"notice-1",workspace_id:"A",business_name:"Example",verdict:"More information needed",overview:[{heading:"Published dates",explanation:"Check the contract dates.",evidence:[{source:"contract_end",quote:"2030-01-27T23:59:59Z"}]}],findings:[{requirement:"Business capacity",alignment:"unknown",explanation:"Confirm your capacity.",tender_evidence:[{source:"amount",quote:"15000000"}],business_evidence:[{source:"workspace_profile.company_size",quote:"solo"},{source:"workspace_profile.business_type",quote:"limited_company"},{source:"workspace_profile.operating_stage",quote:"idea"},{source:"workspace_profile.delivery_model",quote:"manual"},{source:"financials.products.1.name",quote:"Consulting"},{source:"workspace_profile.certifications",quote:'["First aid", "Safeguarding"]'},{source:"workspace_profile.new_internal_field",quote:"Provided"}],next_step:"Check the tender documents."}],limitations:[]};
 const original = JSON.stringify(saved);
 apiRequest.mockResolvedValue({evaluation:saved,stale:false});
 render(<MemoryRouter><TenderEvaluation notice={{id:"notice-1",currency:"GBP"}} token="fixture" workspaceId="A"/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"View saved evaluation"}));
 expect(screen.getByText("1 person")).toBeTruthy();
 expect(screen.getByText("Limited company")).toBeTruthy();
 expect(screen.getByText("Idea stage")).toBeTruthy();
 expect(screen.getByText("Manual / service-led")).toBeTruthy();
 expect(screen.getByText("£15,000,000.00")).toBeTruthy();
 expect(screen.getByText(/27 Jan 2030.*23:59.*UK time/)).toBeTruthy();
 expect(screen.getByText("Your business profile · Team size")).toBeTruthy();
 expect(screen.getByText("Your catalogue · Product 1 · Name")).toBeTruthy();
 expect(screen.getByText("First aid, Safeguarding")).toBeTruthy();
 const text = screen.getByRole("dialog").textContent;
 expect(text).not.toMatch(/workspace_profile|financials\.products|limited_company|2030-01-27T/);
 expect(JSON.stringify(saved)).toBe(original);
 expect(submitAgentRequest).not.toHaveBeenCalled();
});

test("resolves an existing workspace when a tender was opened directly",async()=>{
 submitAgentRequest.mockResolvedValue({procurement:{tender_evaluation:{notice_id:"notice-1",workspace_id:"A",business_name:"Example",verdict:"More information needed",findings:[],limitations:[]}}});
 renderPanel("fixture",null);fireEvent.click(screen.getByRole("button",{name:"Evaluate This Tender for Me"}));
 await waitFor(()=>expect(submitAgentRequest).toHaveBeenCalled());expect(submitAgentRequest.mock.calls[0][0].businessId).toBe("A");
});
