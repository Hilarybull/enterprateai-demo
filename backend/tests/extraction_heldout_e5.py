"""A second held-out set for the shared field extractor (E5), written after the scorer and the extractor were frozen and
never used to tune either. Two or more phrasings per capability, leaning on what the first set had least of: numbers
written as words, prices without a currency sign, indirect requests ("Nova Labs still owes me for..."), and names
containing "to", "for", "from" and "and". Same records, same "today" and same scoring as extraction_heldout.py.

    EXTRACTION_LIVE=1 EXTRACTION_SET=e5 python -m pytest tests/test_extraction_heldout_live.py -s"""
from extraction_heldout import DATA, TODAY  # noqa: F401  (the same records and "today", Wednesday 14 Oct 2026)

CASES: list[tuple[str, str, dict]] = [
    # ── new_contract ──
    ("new_contract", "Smith and Sons want us on a rolling arrangement for window cleaning, two hundred a month, twelve months",
     {"customer_name": "c3", "description": "window cleaning", "price_amount": 200, "price_every": "month", "term": "twelve months"}),
    ("new_contract", "we've agreed to look after the gardens for Fresh from the Farm at 75 per week for six months, can you get that written up",
     {"customer_name": "c5", "description": "look after the gardens", "price_amount": 75, "price_every": "week", "term": "six months"}),
    # ── new_proposal ──
    ("new_proposal", "Back to Basics Ltd asked what we'd charge to run their payroll, I'm thinking 250 a month, put something together for them",
     {"customer_name": "c2", "solution": "run their payroll", "price_amount": 250, "price_every": "month"}),
    ("new_proposal", "pitch Nova Labs a one-off data migration for three thousand five hundred pounds, done in four weeks",
     {"customer_name": "c4", "solution": "a one-off data migration", "total": 3500, "timeline": "four weeks"}),
    # ── new_invoice ──
    ("new_invoice", "Nova Labs still owes me for the website build, 1200", {"customer_name": "c4", "items": [("website build", 1, 1200)]}),
    ("new_invoice", "charge Fresh from the Farm for five window cleans at forty each, due in ten days",
     {"customer_name": "c5", "items": [("window cleans", 5, 40)], "due_date": "2026-10-24"}),
    ("new_invoice", "Pens and Paper Ltd need billing for two boxes of toner at 35",
     {"customer_name": "Pens and Paper Ltd", "items": [("boxes of toner", 2, 35)]}),
    # ── enquiry_to_quote ──
    ("enquiry_to_quote", "Delta Offices Ltd want a price for four oven deep cleans", {"customer_name": "c1", "items": [("oven deep cleans", 4, None)]}),
    ("enquiry_to_quote", "work out a quote for Back to Basics Ltd, ten hours of training at 60 an hour, valid for thirty days",
     {"customer_name": "c2", "items": [("training", 10, 60)], "valid_until": "2026-11-13"}),
    # ── quote_to_cash ──
    ("quote_to_cash", "Delta Offices Ltd said yes to the quote", {"quote_id": "q12"}),
    ("quote_to_cash", "good news, they went for QUO-12, bill them", {"quote_id": "q12"}),
    # ── receipt_send ──
    ("receipt_send", "Smith and Sons would like proof of payment", {"invoice_id": "i9"}),
    ("receipt_send", "can Nova Labs have a receipt for their invoice", {"invoice_id": "i7"}),
    # ── record_payment ──
    ("record_payment", "money's in from Smith and Sons, one hundred and eighty", {"invoice_id": "i9", "amount": 180}),
    ("record_payment", "INV-7 is settled now", {"invoice_id": "i7"}),
    # ── credit_note ──
    ("credit_note", "Nova Labs were overcharged by 25 on INV-7", {"invoice_id": "i7", "refund_amount": 25}),
    ("credit_note", "give Smith and Sons thirty back on INV-9 because one window was missed",
     {"invoice_id": "i9", "refund_amount": 30, "reason": "one window was missed"}),
    # ── new_purchase_order ──
    ("new_purchase_order", "we're running low, get six cases of paper from Costco at twelve a case",
     {"vendor_name": "v2", "items": [("cases of paper", 6, 12)]}),
    ("new_purchase_order", "order twenty filters from Parts for Pros, 4 each, needed by next Monday",
     {"vendor_name": "v3", "items": [("filters", 20, 4)], "delivery_date": "2026-10-19"}),
    # ── supplier_bill ──
    ("supplier_bill", "Fasthosts want 30 for this month's hosting", {"vendor_name": "v1", "items": [("this month's hosting", 1, 30)]}),
    ("supplier_bill", "got an invoice from Parts for Pros, number 5520, three pumps at eighty, due in thirty days",
     {"vendor_name": "v3", "reference": "5520", "items": [("pumps", 3, 80)], "due_date": "2026-11-13"}),
    # ── record_expense ──
    ("record_expense", "spent twelve fifty on parking yesterday", {"description": "parking", "amount": 12.5, "date": "2026-10-13"}),
    ("record_expense", "Costco took 60 for cleaning cloths, already paid", {"vendor_name": "v2", "description": "cleaning cloths", "amount": 60, "paid": "yes"}),
    # ── add_customer ──
    ("add_customer", "I've a new client, Bed and Breakfast for Dogs, their email is hello@bnbdogs.test",
     {"customer_name": "Bed and Breakfast for Dogs", "customer_email": "hello@bnbdogs.test"}),
    ("add_customer", "can you put Sam from the bakery on file as a customer, 07700 900456",
     {"customer_name": "Sam from the bakery", "phone_number": "07700 900456"}),
    # ── add_vendor ──
    ("add_vendor", "we buy from Tools to Go now, set them up, orders@toolstogo.test", {"vendor_name": "Tools to Go", "vendor_email": "orders@toolstogo.test"}),
    ("add_vendor", "keep Bits and Bobs Wholesale as a supplier, phone 0113 496 0001", {"vendor_name": "Bits and Bobs Wholesale", "phone_number": "0113 496 0001"}),
    # ── add_catalogue_item ──
    ("add_catalogue_item", "I'm offering carpet cleaning now, 85 a room", {"name": "carpet cleaning", "price": 85}),
    ("add_catalogue_item", "start selling a deep clean for move-outs at two hundred and fifty, costs me ninety",
     {"name": "deep clean for move-outs", "price": 250, "cost": 90}),
    # ── update_record ──
    ("update_record", "Window clean should really be called Window and frame clean", {"record": "item:p3", "name": "Window and frame clean"}),
    ("update_record", "Oven deep clean has gone up to seventy five", {"record": "item:p1", "base_price": 75}),
    ("update_record", "Delta Offices Ltd moved their emails to accounts@deltaoffices.test", {"record": "customer:c1", "email": "accounts@deltaoffices.test"}),
    # ── marketplace_profile ──
    ("marketplace_profile", "people should know we cover York and Harrogate", {"service_area": "York and Harrogate"}),
    ("marketplace_profile", "we do end of tenancy cleans, that's what the profile should say, site is www.spickspan.test",
     {"description": "end of tenancy cleans", "website": "www.spickspan.test"}),
    # ── marketplace_offering ──
    ("marketplace_offering", "I'd like buyers to be able to find my Window clean", {"product_id": "p3"}),
    ("marketplace_offering", "can bookkeeping go up for sale on the marketplace", {"product_id": "p2"}),
    # ── price_test ──
    ("price_test", "my costs are going up fifteen percent, what should I charge", {"cost_pct": 15}),
    ("price_test", "suppliers just put prices up 8%, test my pricing", {"cost_pct": 8}),
    # ── capacity_check ──
    ("capacity_check", "realistically we manage about thirty jobs a month, is that enough", {"capacity": 30}),
    ("capacity_check", "can my team handle more work", {}),
    # ── scenario_help ──
    ("scenario_help", "Nova Labs might walk away, what would that do to me", {"customer": "c4"}),
    ("scenario_help", "suppose Back to Basics Ltd pays two months late", {"customer": "c2"}),
    # ── idea_validation ──
    ("idea_validation", "thinking about a meal prep service for shift workers in Leicester, is it worth it",
     {"description": "a meal prep service", "customer": "shift workers in Leicester"}),
    ("idea_validation", "would a repair cafe for students work, they can't afford new laptops",
     {"description": "a repair cafe", "customer": "students", "problem": "they can't afford new laptops"}),
    # ── market_size ──
    ("market_size", "how big is the market for dog walking in Bath", {"description": "dog walking", "location": "Bath"}),
    ("market_size", "how many people would buy plant based ready meals for gyms", {"description": "plant based ready meals", "customer": "gyms"}),
    # ── business_plan_draft ──
    ("business_plan_draft", "write me a plan for From Seed to Shelf, a zero waste shop in Norwich",
     {"description": "From Seed to Shelf, a zero waste shop", "location": "Norwich"}),
    ("business_plan_draft", "I need a business plan for mobile bike repairs aimed at commuters",
     {"description": "mobile bike repairs", "customer": "commuters"}),
    # ── sales_letter_draft ──
    ("sales_letter_draft", "write a letter selling our office plant care to landlords in Leeds",
     {"description": "office plant care", "customer": "landlords", "location": "Leeds"}),
    ("sales_letter_draft", "sales letter for Tea and Toast catering, parents are too busy to cook",
     {"description": "Tea and Toast catering", "customer": "parents", "problem": "parents are too busy to cook"}),
    # ── payment_followup ──
    ("payment_followup", "a few people are late paying me, nudge them", {}),
    ("payment_followup", "get on to anyone who owes us money", {}),
    # ── expansion_scenario ──
    ("expansion_scenario", "what would a second van do for us", {}),
    ("expansion_scenario", "is now the time to take on two more staff", {}),
    # ── funding_pack_draft ──
    ("funding_pack_draft", "the bank wants to see something before the loan", {}),
    ("funding_pack_draft", "put together what an investor would want to read", {}),
    # ── launch_evidence_gaps ──
    ("launch_evidence_gaps", "what proof do I still need before going live", {}),
    ("launch_evidence_gaps", "tell me what's holding back my launch", {}),
    # ── offer_review ──
    ("offer_review", "which of the things I sell aren't worth it", {}),
    ("offer_review", "look over my services and tell me what to drop", {}),
    # ── readiness_refresh ──
    ("readiness_refresh", "my numbers changed, redo the readiness score", {}),
    ("readiness_refresh", "run the readiness again", {}),
    # ── registration_checklist ──
    ("registration_checklist", "what do I have to do to become a limited company", {}),
    ("registration_checklist", "steps to get registered with Companies House", {}),
    # ── risk_concentration ──
    ("risk_concentration", "would it hurt if my biggest client left", {}),
    ("risk_concentration", "how spread out is my income across customers", {}),
]
