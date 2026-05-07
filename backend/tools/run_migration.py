"""Run the is_blocked / user_platform_restrictions migration via Supabase Management API."""
import requests

SUPABASE_URL = "https://aczmkkkuoxenipevffxs.supabase.co"
SERVICE_ROLE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjem1ra2t1b3hlbmlwZXZmZnhzIiwicm9sZSI"
    "6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDc0NzM3NywiZXhwIjoyMDkwMzIzMzc3fQ"
    ".FcSwO0sWOgzKoh8mNeV0rgnQJ-R_xjq0TlvI60ruST4"
)

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

STATEMENTS = [
    "alter table users add column if not exists is_blocked boolean not null default false",
    "alter table users add column if not exists block_reason text",
    """create table if not exists user_platform_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  module_key text not null,
  feature_key text not null default '',
  created_by text references users(id),
  created_at timestamptz default now()
)""",
    "create unique index if not exists upr_user_module_feature_idx on user_platform_restrictions(user_id, module_key, feature_key)",
    "create index if not exists upr_user_idx on user_platform_restrictions(user_id)",
]


def run_sql(sql: str) -> dict:
    """Execute SQL via Supabase's /rest/v1/rpc if exec_sql exists, otherwise report."""
    # Supabase doesn't expose direct SQL via REST — use the pg/query management endpoint
    project_ref = "aczmkkkuoxenipevffxs"
    mgmt_url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
    # This requires a Supabase personal access token, not the service role key.
    # We'll fall back to running the SQL via an RPC call if one is defined,
    # or print instructions.
    return {"note": "manual", "sql": sql}


def main():
    print("Checking if columns/table already exist via REST API...\n")

    # Check if is_blocked column exists by querying it
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/users?select=is_blocked&limit=1",
        headers=HEADERS,
    )
    if r.status_code == 200:
        print("✓ is_blocked column already exists in users table")
        col_exists = True
    else:
        print("✗ is_blocked column does not exist yet")
        col_exists = False

    r2 = requests.get(
        f"{SUPABASE_URL}/rest/v1/user_platform_restrictions?select=id&limit=1",
        headers=HEADERS,
    )
    if r2.status_code == 200:
        print("✓ user_platform_restrictions table already exists")
        table_exists = True
    else:
        print("✗ user_platform_restrictions table does not exist yet")
        table_exists = False

    if col_exists and table_exists:
        print("\nAll schema objects are in place. No migration needed.")
        return

    print("\n" + "=" * 60)
    print("MIGRATION REQUIRED")
    print("=" * 60)
    print("Run the following SQL in your Supabase SQL Editor:")
    print(f"  https://supabase.com/dashboard/project/aczmkkkuoxenipevffxs/sql/new")
    print("=" * 60 + "\n")
    for stmt in STATEMENTS:
        print(stmt + ";\n")


if __name__ == "__main__":
    main()
