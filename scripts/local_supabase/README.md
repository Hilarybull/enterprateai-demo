# Running EnterprateAI locally with its own database (safe testing)

This sets up a **local** copy of the app with a **local** Supabase database in Docker. Testing never touches the hosted database, sends no real email, and can't take a payment. Steps tested on Windows (Git Bash) and work the same way on macOS and Linux.

## 0. What you need

- Docker Desktop (running), Node.js 20+, Python 3.13, Git.
- The team's `backend/.env` and `frontend/.env` files, from the team lead. **Never commit them**: `.gitignore` already excludes them.

## 1. Install

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt      # macOS/Linux: .venv/bin/python
cd ../frontend && npm install
```

## 2. Start a local Supabase (database + REST API only)

```bash
mkdir -p ~/ea-localsb && cd ~/ea-localsb
npx --yes supabase@3.2.0 init --force
npx --yes supabase@3.2.0 start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,studio,mailpit,postgres-meta,gotrue
```

The REST API is then at `http://127.0.0.1:54321`, and the database container is called `supabase_db_ea-localsb` (`docker ps` shows the exact name).

**The local service key.** It lives in the gateway's configuration:

```bash
docker exec supabase_kong_ea-localsb sh -c 'grep -oE "sb_secret_[A-Za-z0-9_-]+" /home/kong/kong.yml | head -1'
```

## 3. Build the database from the repository

From the project root:

```bash
bash scripts/local_supabase/apply_schema.sh supabase_db_ea-localsb
```

Every line should read `ok`.

The script first creates **two tables the code uses but no file in the repository creates**: `user_subscriptions` and `idea_validation_results` (`missing_base_tables.sql`). **Team action:** add them to the migrations so a fresh database can be built from the repository alone.

## 4. Start the backend and the frontend safely

```bash
# terminal 1 (project root)
export LOCAL_SUPABASE_URL=http://127.0.0.1:54321
export LOCAL_SUPABASE_SERVICE_KEY=<the key from step 2>
source scripts/local_supabase/safe_env.sh
cd backend && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# terminal 2
cd frontend
VITE_API_URL=http://127.0.0.1:8000 VITE_STRIPE_PUBLISHABLE_KEY= npx vite --host 127.0.0.1 --port 5173
```

`safe_env.sh` points the backend at the local database and switches off real email, Stripe, marketplace invites and activation emails, **for that shell only**. Your `.env` files are not changed.

Open http://127.0.0.1:5173.

## 5. A test account with sample records

1. Sign up in the app (for example `tester@example.com`).
2. Email is off, so mark the address as verified in the **local** database:
   ```bash
   docker exec supabase_db_ea-localsb psql -U postgres -d postgres -c "update users set email_verified = true where id = 'tester@example.com'"
   ```
3. Sign in and finish onboarding; that creates the business. Then find its workspace ID:
   ```bash
   docker exec supabase_db_ea-localsb psql -U postgres -d postgres -tAc "select id from workspaces where user_id = 'tester@example.com'"
   ```
4. Load 14 months of sample invoices and expenses, and put the account on the top plan (local only):
   ```bash
   python scripts/local_supabase/seed_sample_records.py <workspace id> tester@example.com > /tmp/seed.sql
   docker exec -i supabase_db_ea-localsb psql -U postgres -d postgres < /tmp/seed.sql
   ```
5. Open **Simulation**. You should see:
   - **This month** (recorded so far + the rest of the month)
   - **How this was calculated** and **Methods and standards**
   - the **Data check**
   - the **Business settings** card
   - in the manual scenario panel: **Combine changes**, and the new **Raise Investment** and **Buy Equipment** scenarios

## 6. Check the simulation

```bash
backend/.venv/Scripts/python scripts/simulation_release_gate.py      # must end: RELEASE GATE: PASSED
```

## Known local quirks

- **Port 8001.** If something else on your machine uses it (the `.env` file's default API port), run the backend on 8000 as above and start the frontend with `VITE_API_URL=http://127.0.0.1:8000`.
- **Marketplace tests.** With the team's `backend/.env` present, 3 marketplace tests fail, because that file switches marketplace reminders off and invites on. They pass with those two settings at their defaults. This is unrelated to the simulation.
