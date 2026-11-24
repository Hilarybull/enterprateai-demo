#!/usr/bin/env bash
# Build the schema in a LOCAL Supabase database (Docker), from the repository's own files, in order.
# Usage (from the project root):  bash scripts/local_supabase/apply_schema.sh supabase_db_<project>
# Never point this at a hosted or production database.
set -u
DB="${1:?give the local database container name, e.g. supabase_db_localsb}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$(dirname "$0")/apply_schema.log"; : > "$LOG"
run() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1" >>"$LOG" 2>&1; then echo "ok    $(basename "$1")";
  else echo "FAIL  $(basename "$1")  (see $LOG)"; fi
}
# Two tables the code and migrations use but no file in the repository creates (see README): created first.
run "$ROOT/scripts/local_supabase/missing_base_tables.sql"
run "$ROOT/backend/supabase_schema.sql"
for f in $(ls "$ROOT/backend/migrations"/[0-9]*.sql | sort); do run "$f"; done
for f in $(ls "$ROOT/backend/migrations"/[a-z]*.sql | sort); do run "$f"; done
docker exec "$DB" psql -U postgres -d postgres -qc "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role; notify pgrst, 'reload schema';"
