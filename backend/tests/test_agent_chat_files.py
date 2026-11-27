import asyncio
import io
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pypdf import PdfReader, PdfWriter

from app.modules.agent import chat_files, chat_research, chat_agent, research
from app.modules.readiness.service import service_for
from app.modules.agent.router import router, get_orchestrator, _card_kept
from app.shared.auth.deps import get_current_user
from test_agent import Env, OWNER

run = asyncio.run
USER = {"id": OWNER, "email": OWNER}

def test_employee_and_receipt_lookups_read_the_actual_master_and_payment_records():
    from app.modules.agent import chat_records
    env=Env();data=env.businesses["A"]["data"]
    data.setdefault("catalogue",{})["employees"]=[{"id":"e1","name":"Ada","currency":"NGN","salary_amount":200000}]
    employees=run(chat_records.read_records(env.orch,USER,"A",{"section":"employees"}))
    assert employees["records"][0]["name"] == "Ada" and employees["records"][0]["currency"] == "NGN"
    data.setdefault("financials",{})["invoices"]=[{"id":"i1","customer_name":"Buyer","currency":"GBP","payments":[
        {"id":"p1","amount":100,"receipt":{"number":"REC-1","sent_at":"2026-11-27T10:00:00Z"}}]}]
    receipts=run(chat_records.read_records(env.orch,USER,"A",{"section":"receipts"}))
    assert receipts["records"][0]["number"] == "REC-1"
    assert receipts["records"][0]["status"] == "issued" and receipts["records"][0]["delivery_status"] == "sent"
    assert receipts["records"][0]["amount"] == 100


def test_general_chat_upload_is_readable_without_starting_a_funding_case(monkeypatch):
    env = Env()
    from app.modules.agent import chat_actions
    monkeypatch.setattr("app.modules.agent.router.get_orchestrator", lambda: env.orch)
    monkeypatch.setattr(research, "_default_llm", lambda *_: None)
    result = run(chat_actions.attach(USER, "A", "figures.csv", "text/csv", b"Revenue,300\nCosts,100"))
    assert "summarise" in result["message"]
    document = run(chat_files.read_document(env.orch, USER, "A", result["evidence_id"]))
    assert "Revenue,300" in document["text"]
    assert env.businesses["A"]["data"]["agent_files"][0]["id"] == result["evidence_id"]
    assert run(service_for(env.orch).store.list("subjects", "A")) == []


def test_pdf_and_excel_are_real_readable_documents():
    pdf, mime, extension = chat_files.build_export("pdf", "Tender summary", "# Requirements\n\nProvide breakfast for 10 people. Budget: £3,000.\n\nSource: the uploaded tender.")
    assert mime == "application/pdf" and extension == ".pdf"
    assert "breakfast for 10 people" in PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
    assert "Requirements" in chat_files.extract("summary.pdf", pdf)["text"]
    xlsx, mime, extension = chat_files.build_export("xlsx", "Costs", columns=["Item", "Price"], rows=[["Food", 2500], ["Delivery", 500], ["Total", "=SUM(B2:B3)"]])
    book = load_workbook(io.BytesIO(xlsx))
    assert book.active["B4"].value == "=SUM(B2:B3)"
    assert book.active.freeze_panes == "A2"
    extracted = chat_files.extract("costs.xlsx", xlsx)
    assert "Food\t2500" in extracted["text"] and "Delivery\t500" in extracted["text"]
    assert "saved value" in " ".join(extracted["notes"])
    book.close()


def test_docx_csv_and_unreadable_pdf_have_honest_readings():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Deadline: 9 December</w:t></w:r></w:p></w:body></w:document>')
    assert "9 December" in chat_files.extract("tender.docx", output.getvalue())["text"]
    assert "Income,300" in chat_files.extract("figures.csv", b"Income,300\nCost,100")["text"]
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    blank = io.BytesIO()
    writer.write(blank)
    result = chat_files.extract("scan.pdf", blank.getvalue())
    assert result["text"] == "" and result["notes"]
    assert chat_files.extract("broken.xlsx", b"broken")["notes"]


@pytest.mark.parametrize("formula", ['=HYPERLINK("https://example.test","click")', '=WEBSERVICE("https://example.test")', "='[other.xlsx]Sheet1'!A1", "=cmd|' /C calc'!A0"])
def test_generated_workbooks_reject_external_formulas(formula):
    with pytest.raises(ValueError):
        chat_files.build_export("xlsx", "Data", columns=["Value"], rows=[[formula]])


def test_private_file_creation_reading_download_and_history(monkeypatch):
    env = Env()
    result = run(chat_files.create_export(env.orch, USER, "A", {"format": "pdf", "title": "My summary", "content": "Private business notes."}))
    card = result["cards"][0]
    assert _card_kept(card) == card
    read = run(chat_files.read_document(env.orch, USER, "A", card["file_id"]))
    assert "Private business notes" in read["text"] and read["content_is_untrusted_data"]
    assert run(chat_files.list_documents(env.orch, USER, "A"))["documents"][0]["name"] == "My summary.pdf"
    assert env.businesses["A"]["data"]["agent_files"][0]["id"] == card["file_id"]
    with pytest.raises(HTTPException):
        run(chat_files.file_record(env.orch, USER, "B", card["file_id"]))
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: USER
    monkeypatch.setattr("app.modules.agent.router.get_orchestrator", lambda: env.orch)
    response = TestClient(app).get(f'/businesses/A/agent/files/{card["file_id"]}')
    assert response.status_code == 200 and response.content.startswith(b"%PDF")
    assert response.headers["cache-control"] == "private, no-store"
    assert "My%20summary.pdf" in response.headers["content-disposition"]


def test_uploaded_document_paging_and_cross_business_protection():
    env = Env()
    store = service_for(env.orch).store
    async def prepare():
        await store.put_file("A/evidence/notes.txt", ("Known value: 300\n" * 2000).encode(), "text/plain")
        await store.insert("evidence", {"id": "e1", "business_id": "A", "kind": "document", "data": {
            "file": {"path": "A/evidence/notes.txt", "name": "notes.txt", "content_type": "text/plain"}}})
    run(prepare())
    first = run(chat_files.read_document(env.orch, USER, "A", "e1"))
    assert first["next_offset"] == 16000 and len(first["text"]) == 16000
    second = run(chat_files.read_document(env.orch, USER, "A", "e1", first["next_offset"]))
    assert second["text"] and second["document_id"] == "e1"
    with pytest.raises(HTTPException):
        run(chat_files.read_document(env.orch, USER, "B", "e1"))


def test_web_search_uses_configured_provider_and_reports_failure(monkeypatch):
    env = Env()
    search = AsyncMock(return_value={"chat": [{"title": "Official guidance", "url": "https://example.gov/guide", "snippet": "Published guidance"}]})
    monkeypatch.setattr(research, "_search", search)
    result = run(chat_research.search(env.orch, USER, "A", "public tender guidance"))
    assert result["results"][0]["url"] == "https://example.gov/guide"
    assert result["content_is_untrusted_data"] and research._SEARCH_USER.get() is None
    search.side_effect = research.ResearchUnavailable("offline")
    assert "unavailable" in run(chat_research.search(env.orch, USER, "A", "guidance"))["error"]


def test_agent_tools_can_create_a_file_in_the_existing_conversation():
    env = Env()
    result = run(chat_agent._use(env.orch, USER, "A", {}, SimpleNamespace(text="Make a PDF"), "create_chat_file",
                                {"format": "pdf", "title": "Notes", "content": "Based on your uploaded document."}))
    assert result["final"]["cards"][0]["type"] == "download"
    names = {tool["name"] for tool in chat_agent.TOOLS}
    assert {"list_chat_documents", "read_chat_document", "search_web", "read_web_page", "create_chat_file"} <= names
