"""Synthetic workspaces for the premium research matrix (QA R9). Test data only: these names never appear in
production code. They span sectors, stages, countries, currencies and how complete the data is."""

WORKSPACES = {
    "uk_home_services_pre_launch": {
        "data": {"workspace_profile": {"company_name": "Test Gardens", "country": "United Kingdom", "city": "Bristol", "primary_industry": "Home services",
                                       "services": [{"service_name": "Garden maintenance"}], "company_size": "1", "operating_stage": "pre_revenue"},
                 "settings": {"currency": "GBP"}, "catalogue": {"products": [], "customers": []}, "financials": {}},
        "answers": {"launch": {"kind": "service", "sell": "Garden maintenance", "stage": "idea", "customer": "Homeowners", "where": "Bristol",
                               "target_date": "In 1 to 3 months", "evidence": "Three neighbours asked for a quote"},
                    "price_offer": {"sell": "Garden maintenance", "customer": "Homeowners", "price": 35, "cost": 8, "monthly_sales": 30}},
        "basic": True,
    },
    "uk_b2b_software_early_revenue": {
        "data": {"workspace_profile": {"company_name": "Test Ledger Ltd", "country": "United Kingdom", "city": "Manchester", "primary_industry": "Software",
                                       "services": [{"service_name": "Invoice automation software"}], "company_size": "2-5", "operating_stage": "early_revenue"},
                 "settings": {"currency": "GBP"},
                 "catalogue": {"products": [{"id": "p1", "name": "Invoice automation software", "base_price": 49, "cost_of_sales": 6}], "customers": [{"id": "c1", "name": "Client A"}]},
                 "financials": {"invoices": [{"id": "i1", "status": "paid", "total_amount": 49}]}},
        "answers": {"launch": {"kind": "product", "sell": "Invoice automation software", "stage": "ready", "customer": "Small accounting firms",
                               "where": "Manchester", "target_date": "Within a month", "evidence": "12 paying customers"}},
        "basic": True,
    },
    "uk_cafe_idea": {
        "data": {"workspace_profile": {"company_name": "Test Beans", "country": "United Kingdom", "city": "Leeds", "primary_industry": "Food and drink",
                                       "services": [{"service_name": "Specialty coffee"}], "company_size": "2-5", "operating_stage": "idea"},
                 "settings": {"currency": "GBP"}, "catalogue": {"products": [], "customers": []}, "financials": {}},
        "answers": {"test_idea": {"description": "Specialty coffee", "customer": "Office workers", "price": 4, "monthly_sales": 1500, "cost": 1.2,
                                  "fixed_costs": 3000, "capacity": 2500, "demand": "research"}},
        "basic": True,
    },
    "uk_construction_subcontractor_trading": {
        "data": {"workspace_profile": {"company_name": "Test Plastering", "country": "United Kingdom", "city": "Birmingham", "primary_industry": "Construction",
                                       "services": [{"service_name": "Plastering"}], "company_size": "6-10", "operating_stage": "established"},
                 "settings": {"currency": "GBP"},
                 "catalogue": {"products": [{"id": "p1", "name": "Plastering", "base_price": 220}], "customers": [{"id": "c1", "name": "Builder A"}]},
                 "financials": {"invoices": [{"id": "i1", "status": "paid", "total_amount": 2200}]}},
        "answers": {"need_funding": {"amount": 25000, "use": "a second van and tools", "stage": "trading", "route": "loan", "timing": "In 3 to 6 months",
                                     "traction": "4 regular builders, 10 paying customers"}},
        "basic": True,
    },
    "ng_tailoring": {
        "data": {"workspace_profile": {"company_name": "Test Stitches", "country": "Nigeria", "city": "Lagos", "primary_industry": "Fashion",
                                       "services": [{"service_name": "Tailoring"}], "company_size": "2-5", "operating_stage": "early_revenue"},
                 "settings": {"currency": "NGN"}, "catalogue": {"products": [{"id": "p1", "name": "Tailoring", "base_price": 15000}], "customers": []}, "financials": {}},
        "answers": {"launch": {"kind": "service", "sell": "Tailoring", "stage": "testing", "customer": "Office workers", "where": "Lagos",
                               "target_date": "In 3 to 6 months", "evidence": "8 customers paid for a first outfit"}},
        "basic": True,
    },
    "almost_no_data": {
        "data": {"workspace_profile": {"company_name": "Test Co"}, "settings": {}, "catalogue": {"products": [], "customers": []}, "financials": {}},
        "answers": {"launch": {"sell": "Consulting"}},
        "basic": False,
    },
}

GOALS = ("launch", "need_funding", "price_offer", "more_customers", "test_idea")
