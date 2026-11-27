import React from "react";
import {afterEach, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import ChatAttachments from "./ChatAttachments";
import {apiRequest} from "../../api/client";
vi.mock("../../api/client",()=>({apiRequest:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();apiRequest.mockReset();});
const open=()=>fireEvent.click(screen.getByRole("button",{name:"Attach a document"}));
it("opens choices before a file picker and applies the chosen file type",()=>{
 const pick=vi.fn();render(<ChatAttachments businessId="A" onPick={pick}/>);
 const input=document.querySelector('[data-chat-file]');const native=vi.spyOn(input,"click").mockImplementation(()=>{});
 open();expect(screen.getByRole("menu",{name:"Attachment options"})).toBeTruthy();expect(native).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("menuitem",{name:/Upload an image/}));expect(native).toHaveBeenCalledOnce();expect(input.accept).toBe(".png,.jpg,.jpeg");
 const image=new File(["image"],"photo.png",{type:"image/png"});fireEvent.change(input,{target:{files:[image]}});expect(pick).toHaveBeenCalledWith(image);
});
it("browses saved files without submitting a chat and uses the selected one",async()=>{
 const saved=vi.fn();apiRequest.mockResolvedValue({documents:[{id:"doc",name:"Forecast.xlsx"}]});
 render(<ChatAttachments businessId="A" onSaved={saved}/>);open();fireEvent.click(screen.getByRole("menuitem",{name:"Choose a saved file"}));
 await waitFor(()=>expect(screen.getByRole("menuitem",{name:"Forecast.xlsx"})).toBeTruthy());expect(saved).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("menuitem",{name:"Forecast.xlsx"}));expect(saved).toHaveBeenCalledWith({id:"doc",name:"Forecast.xlsx"});expect(screen.queryByRole("menu")).toBeNull();
});
it("supports Escape, keyboard navigation and outside dismissal",()=>{
 render(<ChatAttachments businessId="A"/>);open();const first=screen.getByRole("menuitem",{name:/Upload a document/});expect(document.activeElement).toBe(first);
 fireEvent.keyDown(first,{key:"ArrowDown"});expect(document.activeElement).toBe(screen.getByRole("menuitem",{name:/Upload an image/}));
 fireEvent.keyDown(document.activeElement,{key:"Escape"});expect(screen.queryByRole("menu")).toBeNull();expect(document.activeElement).toBe(screen.getByRole("button",{name:"Attach a document"}));
 open();fireEvent.pointerDown(document.body);expect(screen.queryByRole("menu")).toBeNull();
});
it("offers retry when saved files fail and blocks opening during work",async()=>{
 apiRequest.mockRejectedValue(new Error("offline"));const {rerender}=render(<ChatAttachments businessId="A"/>);open();fireEvent.click(screen.getByRole("menuitem",{name:"Choose a saved file"}));
 await waitFor(()=>expect(screen.getByRole("alert")).toBeTruthy());expect(screen.getByRole("menuitem",{name:"Try again"})).toBeTruthy();
 fireEvent.keyDown(screen.getByRole("menu"),{key:"Escape"});rerender(<ChatAttachments businessId="A" disabled/>);expect(screen.getByRole("button",{name:"Attach a document"}).disabled).toBe(true);
});
