"""A small load test: how the API holds up as more people use it at once. Only cheap, free requests: no AI, no credits, no writes.

    python scripts/load_test.py https://your-demo-api.example --steps 10,25,50,100 --seconds 30

Point it at a demo, never at production with customers on it. Prints requests a second, failures and response times per step.
"""
import argparse
import asyncio
import statistics
import time

import httpx

CALLS = [("GET", "/health"), ("GET", "/goal-suggestions")]


async def user(client, until, out):
    i = 0
    while time.monotonic() < until:
        method, path = CALLS[i % len(CALLS)]
        i += 1
        t = time.monotonic()
        try:
            r = await client.request(method, path)
            out.append((time.monotonic() - t, r.status_code))
        except httpx.HTTPError:
            out.append((time.monotonic() - t, 0))


async def main(base, steps, seconds):
    print("users  req/s  failed  p50 ms  p95 ms  slowest ms")
    async with httpx.AsyncClient(base_url=base, timeout=30, limits=httpx.Limits(max_connections=max(steps))) as client:
        for n in steps:
            out = []
            until = time.monotonic() + seconds
            await asyncio.gather(*(user(client, until, out) for _ in range(n)))
            times = sorted(x[0] * 1000 for x in out) or [0]
            failed = sum(1 for _t, s in out if s == 0 or s >= 500)
            print(f"{n:5}  {len(out) / seconds:5.0f}  {failed:6}  {statistics.median(times):6.0f}  {times[int(len(times) * .95) - 1]:6.0f}  {times[-1]:10.0f}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("base")
    p.add_argument("--steps", default="10,25,50,100")
    p.add_argument("--seconds", type=int, default=30)
    a = p.parse_args()
    asyncio.run(main(a.base.rstrip("/"), [int(x) for x in a.steps.split(",")], a.seconds))
