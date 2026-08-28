# EnterprateAI (MVP)

uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
npm run dev


cd backend
cd frontend


Clear

l s  d k

Production-ready MVP for a business decision SaaS platform with:
- Idea validation (deterministic financial metrics + scoring)
- Registration readiness guidance (rule-based)
- Blueprint document generation (templates + LLM narrative only)
- Simulation engine (deterministic what-if scenarios)

## Core Principle (Enforced)
- All business logic and financial calculations are deterministic, pure Python functions (see `backend/app/modules/idea_validation/calculations.py`).
- AI/LLM is used only for narrative text and document expansion (see `backend/app/modules/blueprint/service.py` and `backend/app/shared/llm/*`).
- LLM output is sanitized to avoid digits to prevent numeric outputs from AI.

## Repo Structure
```
/backend
  /app
    main.py
    /core
    /modules
      /idea_validation
      /business_registration
      /blueprint
      /simulation
    /shared
      /auth
      /llm
      /schemas
      /utils
/frontend
  /src
    /components
    /pages
    /modules
    /api
    /store
docker-compose.yml
.env.example
```

## Quick Start (Docker)
1) Create env:
   - Copy `.env.example` to `.env` and set `JWT_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2) Run API:
   - `docker compose up --build`
3) API health:
   - `GET http://localhost:8000/health`

## Local Backend (FastAPI)
From `backend/`:
1) `python -m venv .venv`
2) Activate venv
3) `pip install -r requirements.txt`
4) `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

Env vars (example in `.env.example`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET_KEY`
- `OPENAI_API_KEY` / `CLAUDE_API_KEY` (optional)

## Local Frontend (Vite + React, JavaScript)
From `frontend/`:
1) `npm install`
2) `npm run dev`

Frontend env:
- `VITE_API_URL` (recommended) or `REACT_APP_BACKEND_URL` (supported) — defaults to `http://localhost:8000`

## Key API Routes
- Auth:
  - `POST /auth/register`
  - `POST /auth/login`
- Idea Validation:
  - `POST /validation/create`
  - `GET /validation/{id}`
  - `POST /validation/evaluate`
- Registration Guidance:
  - `POST /registration/guide`
- Blueprint:
  - `POST /blueprint/generate`
- Simulation:
  - `POST /simulation/run`

## Notes
- Modular monolith: each module has its own router, schemas, and service layer, and communicates internally via function calls (not HTTP).
- Supabase (Postgres) stores users, workspaces, blueprints, and scenario data.
