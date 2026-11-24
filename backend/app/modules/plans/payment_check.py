"""Read-only Stripe configuration diagnostic. Never creates payments or customers."""
import asyncio
import json
import httpx
from app.core.config import get_settings

async def main():
    settings=get_settings()
    key=settings.stripe_secret_key or ""
    report={"mode":"test" if key.startswith("sk_test_") else "live" if key.startswith("sk_live_") else "unconfigured",
            "local_webhook_secret_configured":bool(settings.stripe_webhook_secret),"prices":{}}
    if not key:
        print(json.dumps(report));return
    async with httpx.AsyncClient(timeout=12,headers={"Authorization":"Bearer "+key}) as client:
        for name in ("stripe_price_insight_starter_monthly","stripe_price_insight_starter_annual","stripe_price_decision_engine_monthly","stripe_price_decision_engine_annual"):
            price=getattr(settings,name,None)
            if not price:
                report["prices"][name]={"configured":False};continue
            try:
                response=await client.get("https://api.stripe.com/v1/prices/"+price)
                if response.status_code!=200:
                    report["prices"][name]={"configured":True,"http_status":response.status_code};continue
                data=response.json()
                report["prices"][name]={"configured":True,"active":data.get("active"),"live":data.get("livemode"),"currency":data.get("currency"),"amount_minor":data.get("unit_amount"),"interval":(data.get("recurring") or {}).get("interval")}
            except httpx.HTTPError as error:report["prices"][name]={"configured":True,"connection_error":type(error).__name__}
        try:
            response=await client.get("https://api.stripe.com/v1/webhook_endpoints",params={"limit":100})
            report["webhook_endpoint_check_status"]=response.status_code
            if response.status_code==200:
                report["webhook_endpoints"]=[{"url":item.get("url"),"status":item.get("status"),"enabled_events":item.get("enabled_events")} for item in response.json().get("data",[])]
        except httpx.HTTPError as error:report["webhook_connection_error"]=type(error).__name__
    print(json.dumps(report))

if __name__=="__main__":asyncio.run(main())
