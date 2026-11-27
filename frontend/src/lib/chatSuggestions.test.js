import { expect, it } from "vitest";
import { composerSuggestions } from "./chatSuggestions";
const starters=[{label:"I need funding",prompt:"I need funding"},{label:"Draft a quotation",prompt:"Draft a quotation"}];
const last={prompts:[{label:"Look up today's exchange rate",prompt:"Look up today's exchange rate for me"},{label:"Cancel",prompt:"Cancel"}],answersQuestion:true};
it("shows only current reply options matching the owner's draft",()=>{
  expect(composerSuggestions({last,hasUser:true,draft:"please look up"})).toEqual([last.prompts[0]]);
  expect(composerSuggestions({last,hasUser:true,draft:"draft a contract",starters})).toEqual([]);
});
it("never brings generic starters back into an active conversation",()=>{
  expect(composerSuggestions({last:{},hasUser:true,starters})).toEqual([]);
  expect(composerSuggestions({last,answered:true,hasUser:true,starters})).toEqual([]);
});
it("keeps only relevant starters as a new message is typed",()=>{
  expect(composerSuggestions({starters,draft:"I need fund"})).toEqual([starters[0]]);
  expect(composerSuggestions({starters,draft:"look up a rate"})).toEqual([]);
});
it("does not show stale options while working or after a failed response",()=>{
  expect(composerSuggestions({last,hasUser:true,blocked:true})).toEqual([]);
  expect(composerSuggestions({last:{...last,failed:true},hasUser:true})).toEqual([]);
});
it("recognises yes and no drafts without inventing additional answers",()=>{
  const current={prompts:[{label:"Use £566",prompt:"Apply"},{label:"Cancel",prompt:"Cancel"}]};
  expect(composerSuggestions({last:current,hasUser:true,draft:"ye"})).toEqual([current.prompts[0]]);
  expect(composerSuggestions({last:current,hasUser:true,draft:"no"})).toEqual([current.prompts[1]]);
});
