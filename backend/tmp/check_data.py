
import asyncio
from app.core.supabase import sb_select

async def main():
    res = await sb_select("workspaces", filters=[("name", "ilike", "%opeoluwa%")])
    if not res:
        print("No workspace found")
        return
    
    ws = res[0]
    data = ws.get("data", {})
    financials = data.get("financials", {})
    invoices = financials.get("invoices", [])
    
    print(f"Total invoices: {len(invoices)}")
    for inv in invoices:
        print(f"Inv: {inv.get('customer_name')} | Status: {inv.get('status')} | Total: {inv.get('total_amount')} | ID: {inv.get('id')}")

if __name__ == "__main__":
    asyncio.run(main())
