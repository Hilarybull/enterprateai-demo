"""A third held-out set for the shared field extractor, written after the E5 fixes (numbers as words in dates and
durations; a paraphrased text value replaced by the owner's own words) and frozen before it was run once. Never used to
tune anything. Two or more phrasings per capability, again leaning on numbers as words, prices without a currency sign,
indirect requests and names containing "to", "for", "from" and "and". Same records, "today" and scoring as the others.

    EXTRACTION_LIVE=1 EXTRACTION_SET=e6 python -m pytest tests/test_extraction_heldout_live.py -s"""
from extraction_heldout import DATA, TODAY  # noqa: F401  (Wednesday 14 Oct 2026)

CASES: list[tuple[str, str, dict]] = [
    # ── new_contract ──
    ("new_contract", "Delta Offices Ltd are signing up for daily reception cover at ninety a day for eighteen months",
     {"customer_name": "c1", "description": "daily reception cover", "price_amount": 90, "price_every": "day", "term": "18 months"}),
    ("new_contract", "put Nova Labs on a contract for server monitoring, 400 every quarter, starting tomorrow",
     {"customer_name": "c4", "description": "server monitoring", "price_amount": 400, "price_every": "quarter", "start_date": "2026-10-15"}),
    ("new_contract", "Fresh from the Farm agreed a one-off orchard survey for six hundred, can you draw up the paperwork",
     {"customer_name": "c5", "description": "orchard survey", "total": 600}),
    # ── new_proposal ──
    ("new_proposal", "Smith and Sons keep losing receipts, I'd like to offer them bookkeeping at 180 a month for two years",
     {"customer_name": "c3", "problem": "keep losing receipts", "solution": "bookkeeping", "price_amount": 180, "price_every": "month", "timeline": "2 years"}),
    ("new_proposal", "send a proposal to a new client, Cake to Order Ltd, for a website refresh at two thousand, valid for fourteen days",
     {"customer_name": "Cake to Order Ltd", "solution": "a website refresh", "total": 2000, "valid_until": "2026-10-28"}),
    ("new_proposal", "Nova Labs might want help with their hiring, pitch them recruitment support at 1500 per month",
     {"customer_name": "c4", "solution": "recruitment support", "price_amount": 1500, "price_every": "month"}),
    # ── new_invoice ──
    ("new_invoice", "Back to Basics Ltd haven't been billed for the eight window cleans yet, forty each, due in a fortnight",
     {"customer_name": "c2", "items": [("window cleans", 8, 40)], "due_date": "2026-10-28"}),
    ("new_invoice", "Smith and Sons owe 350 for the boiler service, add VAT at twenty percent",
     {"customer_name": "c3", "items": [("boiler service", 1, 350)], "vat_rate": 20}),
    ("new_invoice", "invoice Rise and Shine Cafe for twelve coffee machine cleans at 25, due in fifteen days",
     {"customer_name": "Rise and Shine Cafe", "items": [("coffee machine cleans", 12, 25)], "due_date": "2026-10-29"}),
    # ── enquiry_to_quote ──
    ("enquiry_to_quote", "Nova Labs asked how much for two bookkeeping months", {"customer_name": "c4", "items": [("bookkeeping months", 2, None)]}),
    ("enquiry_to_quote", "quote Fresh from the Farm six oven deep cleans at sixty, valid for twenty-one days",
     {"customer_name": "c5", "items": [("oven deep cleans", 6, 60)], "valid_until": "2026-11-04"}),
    # ── quote_to_cash ──
    ("quote_to_cash", "Delta are happy with the quotation, go ahead and invoice", {"quote_id": "q12"}),
    ("quote_to_cash", "QUO-12 got the thumbs up", {"quote_id": "q12"}),
    # ── receipt_send ──
    ("receipt_send", "email Smith and Sons something to confirm we got their money", {"invoice_id": "i9"}),
    ("receipt_send", "INV-7 needs a receipt", {"invoice_id": "i7"}),
    # ── record_payment ──
    ("record_payment", "Nova Labs transferred two hundred against INV-7", {"invoice_id": "i7", "amount": 200}),
    ("record_payment", "the Smith and Sons invoice has been paid in full", {"invoice_id": "i9"}),
    # ── credit_note ──
    ("credit_note", "refund Nova Labs fifteen on INV-7, they cancelled one session", {"invoice_id": "i7", "refund_amount": 15, "reason": "they cancelled one session"}),
    ("credit_note", "Smith and Sons should get 40 off INV-9", {"invoice_id": "i9", "refund_amount": 40}),
    # ── new_purchase_order ──
    ("new_purchase_order", "ask Fasthosts for three extra mailboxes at five each", {"vendor_name": "v1", "items": [("extra mailboxes", 3, 5)]}),
    ("new_purchase_order", "we need fifty bin bags from Costco at 2 a bag, delivered tomorrow",
     {"vendor_name": "v2", "items": [("bin bags", 50, 2)], "delivery_date": "2026-10-15"}),
    # ── supplier_bill ──
    ("supplier_bill", "Parts for Pros billed us for two valves at thirty five each, it's due in ten days",
     {"vendor_name": "v3", "items": [("valves", 2, 35)], "due_date": "2026-10-24"}),
    ("supplier_bill", "Costco invoice 8812 for 120 of cleaning stock", {"vendor_name": "v2", "reference": "8812", "items": [("cleaning stock", 1, 120)]}),
    # ── record_expense ──
    ("record_expense", "I paid forty-five for a train ticket today", {"description": "train ticket", "amount": 45, "date": "2026-10-14"}),
    ("record_expense", "Fasthosts charged 18 for the domain, not paid yet", {"vendor_name": "v1", "description": "the domain", "amount": 18, "paid": "no"}),
    # ── add_customer ──
    ("add_customer", "save Hands to Help Ltd as a client, contact is ops@handstohelp.test", {"customer_name": "Hands to Help Ltd", "customer_email": "ops@handstohelp.test"}),
    ("add_customer", "I've started working for Bread and Roses Bakery, number 07700 900789",
     {"customer_name": "Bread and Roses Bakery", "phone_number": "07700 900789"}),
    # ── add_vendor ──
    ("add_vendor", "we're going to buy paint from Coat for Coat, add them, sales@coatforcoat.test", {"vendor_name": "Coat for Coat", "vendor_email": "sales@coatforcoat.test"}),
    ("add_vendor", "set up Nuts and Bolts Direct as a supplier", {"vendor_name": "Nuts and Bolts Direct"}),
    # ── add_catalogue_item ──
    ("add_catalogue_item", "we can sell gutter clearing now, ninety five a house", {"name": "gutter clearing", "price": 95}),
    ("add_catalogue_item", "add pressure washing to what I sell, 120, it costs me thirty", {"name": "pressure washing", "price": 120, "cost": 30}),
    # ── update_record ──
    ("update_record", "Bookkeeping is now three hundred and fifty", {"record": "item:p2", "base_price": 350}),
    ("update_record", "Costco should be listed as Costco Wholesale", {"record": "vendor:v2", "name": "Costco Wholesale"}),
    ("update_record", "Nova Labs' accounts email is now billing@novalabs.test", {"record": "customer:c4", "email": "billing@novalabs.test"}),
    # ── marketplace_profile ──
    ("marketplace_profile", "say on my profile that we clean offices and shops", {"description": "we clean offices and shops"}),
    ("marketplace_profile", "we work across Bristol and Bath now, website www.brightclean.test", {"service_area": "Bristol and Bath", "website": "www.brightclean.test"}),
    # ── marketplace_offering ──
    ("marketplace_offering", "advertise my oven deep clean to buyers", {"product_id": "p1"}),
    ("marketplace_offering", "make Window clean visible on the marketplace", {"product_id": "p3"}),
    # ── price_test ──
    ("price_test", "rent's up twelve percent, what does that do to my prices", {"cost_pct": 12}),
    ("price_test", "should I put my prices up", {}),
    # ── capacity_check ──
    ("capacity_check", "we're doing fifty jobs a month flat out, can we grow", {"capacity": 50}),
    ("capacity_check", "with 25 jobs a month max, how close am I to full", {"capacity": 25}),
    # ── scenario_help ──
    ("scenario_help", "what happens to cash if Fresh from the Farm stops ordering", {"customer": "c5"}),
    ("scenario_help", "model Delta Offices Ltd paying ninety days late", {"customer": "c1"}),
    # ── idea_validation ──
    ("idea_validation", "is a laundry pickup service for care homes in Derby a good idea",
     {"description": "a laundry pickup service", "customer": "care homes", "location": "Derby"}),
    ("idea_validation", "check this: allotment tool hire, gardeners hate buying tools they use twice a year",
     {"description": "allotment tool hire", "customer": "gardeners", "problem": "gardeners hate buying tools they use twice a year"}),
    # ── market_size ──
    ("market_size", "how much demand is there for wedding cakes in Cardiff", {"description": "wedding cakes", "location": "Cardiff"}),
    ("market_size", "size the market for bike servicing for delivery riders", {"description": "bike servicing", "customer": "delivery riders"}),
    # ── business_plan_draft ──
    ("business_plan_draft", "plan for a mobile phone repair stall at markets in Hull", {"description": "a mobile phone repair stall", "location": "Hull"}),
    ("business_plan_draft", "draft a business plan for Bread to Door, fresh bread delivery for busy families",
     {"description": "Bread to Door, fresh bread delivery", "customer": "busy families"}),
    # ── sales_letter_draft ──
    ("sales_letter_draft", "write a sales letter for our window cleaning aimed at restaurants in York",
     {"description": "window cleaning", "customer": "restaurants", "location": "York"}),
    ("sales_letter_draft", "letter to sell dog walking to people who work long hours",
     {"description": "dog walking", "customer": "people who work long hours"}),
    # ── payment_followup ──
    ("payment_followup", "anyone who is past their due date, chase them", {}),
    ("payment_followup", "Nova Labs still hasn't paid, send them a reminder", {}),
    # ── expansion_scenario ──
    ("expansion_scenario", "what if we opened in a second city", {}),
    ("expansion_scenario", "show me what hiring two more cleaners does", {}),
    # ── funding_pack_draft ──
    ("funding_pack_draft", "I'm applying for a start up loan, get my documents together", {}),
    ("funding_pack_draft", "build the pack for my grant application", {}),
    # ── launch_evidence_gaps ──
    ("launch_evidence_gaps", "before I open what am I missing", {}),
    ("launch_evidence_gaps", "check my launch evidence", {}),
    # ── offer_review ──
    ("offer_review", "which service makes me the least", {}),
    ("offer_review", "go through my products and rank them", {}),
    # ── readiness_refresh ──
    ("readiness_refresh", "update my readiness score with the new figures", {}),
    ("readiness_refresh", "recalculate how ready I am", {}),
    # ── registration_checklist ──
    ("registration_checklist", "what do I need to register as a sole trader", {}),
    ("registration_checklist", "help me set up a limited company", {}),
    # ── risk_concentration ──
    ("risk_concentration", "how much of my money comes from Delta", {}),
    ("risk_concentration", "is too much of my revenue from a few clients", {}),
]
