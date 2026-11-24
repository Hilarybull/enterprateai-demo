"""LOCAL ONLY: give a test business 14 months of records, in the same format the demo business uses.
Writes SQL to stdout; applied with psql to the local Docker database."""
import json, random
from datetime import date, timedelta

rng = random.Random(7)
import sys
WS = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: python seed_sample_records.py <workspace id> [account email]")
EMAIL = sys.argv[2] if len(sys.argv) > 2 else "tester@example.com"
customers = [("cust-101", "Northgate Dental"), ("cust-102", "Brightside Cafe Group"), ("cust-103", "Hale & Co Solicitors"),
             ("cust-104", "Pennine Builders"), ("cust-105", "Oakwood Vets"), ("cust-106", "Riverside Gym")]
products = [("prod-101", "Monthly bookkeeping", 650), ("prod-102", "Cash-flow forecast", 900), ("prod-103", "Year-end pack", 1400)]
invoices, expenses = [], []
n = 0
start = date(2025, 9, 1)
for k in range(15):                                   # Sep 2025 .. Nov 2026
    y, m = (start.year + (start.month - 1 + k) // 12, (start.month - 1 + k) % 12 + 1)
    clients = customers[: min(len(customers), 3 + k // 4)]        # the client base grows over the year
    for cid, cname in clients:
        if y == 2026 and m == 11 and rng.random() < 0.4:
            continue                                  # November is still in progress
        pid, pname, price = rng.choice(products)
        amount = round(price * rng.uniform(0.9, 1.15), 2)
        day = rng.randint(1, 18 if (y, m) == (2026, 11) else 26)
        issued = date(y, m, day)
        due = issued + timedelta(days=30)
        n += 1
        unpaid = (y, m) in ((2026, 10), (2026, 11)) and rng.random() < 0.35
        inv = dict(id=f"inv-{n:03d}", number=f"INV-{n:03d}", date=issued.isoformat(), due_date=due.isoformat(),
                   status="sent" if unpaid else "paid", currency="GBP", customer_id=cid, customer_name=cname,
                   items=[dict(name=pname, quantity=1, product_id=pid, unit_price=amount, total_amount=amount)],
                   product_ids=[pid], product_names=[pname], total_amount=amount, subtotal_amount=amount)
        if not unpaid:
            paid = min(issued + timedelta(days=rng.randint(10, 32)), date(2026, 11, 18))
            inv["paid_at"] = paid.isoformat()
        invoices.append(inv)
    if (y, m) <= (2026, 11):
        for cat, desc, amt in (("Rent", "Office rent", 850), ("Software", "Accounting software", 140),
                               ("Subcontractor", "Freelance bookkeeper", round(rng.uniform(600, 1100), 2))):
            d = date(y, m, 3 if cat == "Rent" else 12)
            if d > date(2026, 11, 18):
                continue
            expenses.append(dict(id=f"exp-{len(expenses) + 1:03d}", date=d.isoformat(), price=amt, status="paid",
                                 category=cat, currency="GBP", description=desc))

payload = json.dumps(dict(invoices=invoices, expenses=expenses)).replace("'", "''")
print(f"update workspaces set data = jsonb_set(coalesce(data,'{{}}'::jsonb), '{{financials}}', '{payload}'::jsonb, true) where id = '{WS}';")
print(f"insert into user_subscriptions (user_id, plan_key, billing_period, status, current_period_start, current_period_end) "
      f"values ('{EMAIL}', 'strategic_business_os', 'monthly', 'active', now(), now() + interval '1 year') "
      f"on conflict (user_id) do update set plan_key = excluded.plan_key, status = 'active', current_period_end = excluded.current_period_end;")
import sys
print(f"-- {len(invoices)} invoices ({sum(1 for i in invoices if i['status'] != 'paid')} unpaid), {len(expenses)} expenses", file=sys.stderr)
