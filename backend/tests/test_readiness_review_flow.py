import pytest
from test_goal_onboarding import world, _funding, OWNER, run
from test_round14_converse_funding import no_background_connections
from app.modules.agent.readiness_chat import remaining_card, review_values, decide_item
from app.modules.readiness.service import service_for, Conflict, Invalid
from app.modules.readiness import rules

@pytest.mark.parametrize("review",["documents","attestation"])
def test_review_type_without_content_is_empty(review):
    subject={"id":"case","data":{},"profile_definition":{"sections":[{"key":"documents","fields":[]}],"required_documents":[{"key":"plan","label":"Plan"}]},"evidence":[]}
    assert review_values(subject,{"section":"documents","code":"C8.A","review":review},"funding",{})==[]

@pytest.mark.parametrize("topic",["funding","launch"])
def test_zero_and_false_are_real_values(topic):
    subject={"data":{"count":0},"profile_definition":{"sections":[{"key":"team","fields":[{"key":"count","label":"Count"}]}]}}
    assert review_values(subject,{"section":"team"},topic,{})[0]["value"]=="0"

@pytest.mark.parametrize("topic,section,code,review", [("funding","traction","C4.A","evidence"),("funding","traction","C4.B","attestation"),("launch","customers","C1.A","evidence"),("launch","customers","C1.B","attestation")])
def test_section_answers_and_drafts_are_not_attached_evidence(topic,section,code,review):
    evidence_code = "C4.A" if topic == "funding" else "C1.A"
    subject={"id":"case","data":{"summary":"No traction yet"},"profile_definition":{"sections":[{"key":section,"fields":[{"key":"summary","label":"Summary"}],"evidence":[evidence_code]}]},"evidence":[]}
    item={"section":section,"code":code,"review":review}
    assert review_values(subject,item,topic,{"summary":{"value":"Research narrative"}})==[]
    subject["evidence"]=[{"id":"e1","title":"Customer interviews","claim":"Five interviews","links":[{"subject_id":"other","check":evidence_code}]}]
    assert review_values(subject,item,topic,{})==[]
    subject["evidence"][0]["links"][0]["subject_id"]="case"
    assert review_values(subject,item,topic,{})[0]["value"]=="Five interviews"

def setup(world):
    env,store,client,who=world;who["user"]=OWNER
    _,made=_funding(client);cid=made["handoff"]["subject_id"]
    # The Agent may have entered a proposal without the owner's final amount/date confirmation.
    svc=service_for(env.orch);row=run(svc.store.get("subjects",cid))
    run(svc.store.update("subjects",cid,{"data":{**row["data"],"timing_confirmed":False}},expect_revision=row["revision"]))
    run(svc.request_assessment(OWNER,"A",rules.FUNDING,cid,idempotency_key="review-fixture",email=OWNER))
    card=run(remaining_card(env.orch,{"id":OWNER},"A","funding",[],[{"case_id":cid}]))
    return env,cid,card

def test_approval_confirms_entered_amount_and_date_without_completing_missing_items(world):
    env,cid,card=setup(world)
    target=next(item for item in card["items"] if item["code"] in ("C1.A","G1"))
    assert target["has_values"] and target["values"]
    out=run(decide_item(env.orch,{"id":OWNER},"A","funding",cid,target["code"],card["revision"],True))
    subject=run(service_for(env.orch).get_subject(OWNER,"A",rules.FUNDING,cid))
    assert subject["data"]["timing_confirmed"] is True
    assert not any(item["code"] in ("C1.A","G1") for item in out["card"]["items"])
    assert out["card"]["items"] and not env.meter.charges

def test_reject_removes_only_the_reviewed_values_and_preserves_currency_and_purpose(world):
    env,cid,card=setup(world)
    target=next(item for item in card["items"] if item["code"] in ("C1.A","G1"))
    out=run(decide_item(env.orch,{"id":OWNER},"A","funding",cid,target["code"],card["revision"],False))
    row=run(service_for(env.orch).store.get("subjects",cid))
    assert row["data"].get("target_amount") in (None,"")
    assert row["data"]["currency"]=="GBP" and row["data"]["purpose"]=="hiring"
    assert next(item for item in out["card"]["items"] if item["code"] in ("C1.A","G1"))["has_values"] is False

def test_stale_and_empty_reviews_are_refused(world):
    env,cid,card=setup(world)
    with pytest.raises(Conflict):
        run(decide_item(env.orch,{"id":OWNER},"A","funding",cid,"C1.A",card["revision"]-1,True))
    empty=next(item for item in card["items"] if not item["has_values"])
    with pytest.raises(Invalid):
        run(decide_item(env.orch,{"id":OWNER},"A","funding",cid,empty["code"],card["revision"],True))
    assert not env.meter.charges


def test_empty_forecast_scaffold_is_not_content_to_review():
    subject={"data":{"currency":"GBP"},"forecast_draft":{"months":[{"month":"2026-12","receipts":None,"payments":None}]}}
    assert review_values(subject,{"review":"forecast"},"funding",{})==[]
    subject["forecast_draft"]["months"][0]["receipts"]=0
    assert "GBP 0" in review_values(subject,{"review":"forecast"},"funding",{})[0]["value"]

def test_economics_review_requires_saved_inputs_not_unapproved_benchmarks():
    subject={"data":{},"profile_definition":{"sections":[{"key":"finances","fields":[{"key":"use_of_funds"}]}]}}
    assert review_values(subject,{"section":"finances","code":"C5.B","review":"attestation"},"funding",{"economics.price":{"value":50}})==[]
    subject["data"]={"economics":{"price":0,"direct_cost":0,"fixed_costs_monthly":0}}
    assert len(review_values(subject,{"section":"finances","code":"C5.B","review":"attestation"},"funding",{}))==3

def test_launch_approval_keeps_missing_details_pending(world):
    from test_goal_onboarding import _launch
    env,store,client,who=world;who["user"]=OWNER
    _,made=_launch(client);cid=made["handoff"]["subject_id"]
    card=run(remaining_card(env.orch,{"id":OWNER},"A","launch",[],[{"case_id":cid}]))
    target=next(item for item in card["items"] if item["has_values"] and not item.get("review"))
    out=run(decide_item(env.orch,{"id":OWNER},"A","launch",cid,target["code"],card["revision"],True))
    assert out["card"]["topic"]=="launch" and out["card"]["items"]
    assert not env.meter.charges
