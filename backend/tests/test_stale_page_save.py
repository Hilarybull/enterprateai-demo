"""A page that saves from an out-of-date copy must not erase what the Agent added since.

From the demo call: the Agent prepared an invoice for a new customer; the Catalogue and Business
Operations pages did not show it; and the next request for the same customer was treated as a
brand-new customer. Both pages save their whole section from the copy they loaded, so a save from
a copy loaded before the Agent's work would wipe the customer (and the document) it had added."""
import copy

from app.shared.workspace_merge import preserve_server_fields

AGENT_CUSTOMER = {"id": "c-abc", "name": "ABC Ltd", "email": "accounts@abc.test", "created_by_agent": True, "agent_run_id": "run-1"}
AGENT_INVOICE = {"id": "inv-1", "invoice_number": "INV-1071026", "customer_name": "ABC Ltd", "status": "draft", "total_amount": 342, "agent_run_id": "run-1", "source": "EnterprateAI Agent"}


def _stored():
    return {
        "catalogue": {"customers": [{"id": "c-old", "name": "Frank", "email": "frank@frank.test"}, dict(AGENT_CUSTOMER)],
                      "products": [{"id": "p-old", "name": "Bookkeeping", "base_price": 300}, {"id": "p-new", "name": "Research", "base_price": 300, "created_by_agent": True}],
                      "vendors": []},
        "financials": {"invoices": [{"id": "inv-hand", "invoice_number": "INV-7", "customer_name": "Frank", "status": "sent"}, dict(AGENT_INVOICE)],
                       "quotes": [], "expenses": [], "contracts": [],
                       "proposals": [{"id": "pro-1", "reference": "PRO-1", "agent_run_id": "run-2"}], "credit_notes": [{"id": "cn-1", "agent_run_id": "run-3"}]},
    }


def _names(rows):
    return [r.get("name") or r.get("invoice_number") or r.get("reference") or r["id"] for r in rows]


def test_the_catalogue_saved_from_an_older_copy_keeps_the_customer_and_item_the_agent_added():
    stored = _stored()
    # The Catalogue page loaded before the Agent's invoice: it knows Frank and Bookkeeping only, and the owner adds a customer by hand.
    stale = {"catalogue": {"customers": [{"id": "c-old", "name": "Frank", "email": "frank@frank.test"}, {"id": "c-hand", "name": "Typed In Ltd"}],
                           "products": [{"id": "p-old", "name": "Bookkeeping", "base_price": 350}], "vendors": []},
             "financials": copy.deepcopy(stored["financials"])}
    merged = preserve_server_fields(stale, stored)
    assert _names(merged["catalogue"]["customers"]) == ["Frank", "Typed In Ltd", "ABC Ltd"]      # the Agent's customer is still there, with its email
    assert merged["catalogue"]["customers"][-1]["email"] == "accounts@abc.test"
    assert _names(merged["catalogue"]["products"]) == ["Bookkeeping", "Research"]
    assert merged["catalogue"]["products"][0]["base_price"] == 350          # the owner's own edit stands


def test_archiving_and_purging_in_the_catalogue_still_work():
    stored = _stored()
    stored["catalogue"]["customers"].append({"id": "c-gone", "name": "Long Gone", "archived": True, "archived_at": "2026-01-01T00:00:00Z"})
    page = copy.deepcopy(stored)
    page["catalogue"]["customers"] = [c for c in page["catalogue"]["customers"] if c["id"] != "c-gone"]      # purged: it had been archived long enough
    page["catalogue"]["customers"][1]["archived"] = True                    # and the owner archives ABC Ltd
    merged = preserve_server_fields(page, stored)
    assert _names(merged["catalogue"]["customers"]) == ["Frank", "ABC Ltd"] and merged["catalogue"]["customers"][1]["archived"] is True
    assert "Long Gone" not in _names(merged["catalogue"]["customers"])      # a purge is not undone


def test_business_operations_saved_from_an_older_copy_keeps_the_agents_documents():
    stored = _stored()
    # Business Operations saves only the four lists it knows, from a copy without the Agent's invoice.
    stale = {"catalogue": copy.deepcopy(stored["catalogue"]),
             "financials": {"invoices": [{"id": "inv-hand", "invoice_number": "INV-7", "customer_name": "Frank", "status": "paid"}], "quotes": [], "expenses": [], "contracts": []}}
    merged = preserve_server_fields(stale, stored)
    assert _names(merged["financials"]["invoices"]) == ["INV-7", "INV-1071026"]      # not erased
    assert merged["financials"]["invoices"][0]["status"] == "paid"          # the owner's change stands
    assert _names(merged["financials"]["proposals"]) == ["PRO-1"] and len(merged["financials"]["credit_notes"]) == 1      # lists the page has never heard of are kept whole
    assert "deleted_ids" not in merged["financials"]


def test_a_document_the_owner_deletes_is_deleted_and_stays_deleted():
    stored = _stored()
    page = {"catalogue": copy.deepcopy(stored["catalogue"]),
            "financials": {"invoices": [dict(stored["financials"]["invoices"][0])], "quotes": [], "expenses": [], "contracts": [], "deleted_ids": ["inv-1"]}}
    merged = preserve_server_fields(page, stored)
    assert _names(merged["financials"]["invoices"]) == ["INV-7"]            # the Agent's invoice was deleted on purpose: it is not brought back
    assert "deleted_ids" not in merged["financials"]                        # the list of what was deleted is never stored
    # A record made by hand that is missing from a save is treated as before (only the server's own records are carried over).
    page = {"catalogue": copy.deepcopy(stored["catalogue"]), "financials": {"invoices": [dict(AGENT_INVOICE)], "quotes": [], "expenses": [], "contracts": []}}
    assert _names(preserve_server_fields(page, stored)["financials"]["invoices"]) == ["INV-1071026"]


def test_a_save_that_touches_neither_section_changes_nothing():
    stored = _stored()
    profile_only = {"workspace_profile": {"company_name": "Realtouch Research"}}
    assert preserve_server_fields(dict(profile_only), stored) == profile_only
    both = copy.deepcopy(stored)
    assert preserve_server_fields(copy.deepcopy(both), stored) == both      # an up-to-date copy is saved exactly as it is
