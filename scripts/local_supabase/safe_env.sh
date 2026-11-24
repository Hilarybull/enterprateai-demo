# Settings for a SAFE local run: they override backend/.env for this shell only.
# Usage:  export LOCAL_SUPABASE_URL=http://127.0.0.1:54321  LOCAL_SUPABASE_SERVICE_KEY=<local key, see README>
#         source scripts/local_supabase/safe_env.sh   then start the backend in the same shell.
# Effect: the LOCAL database only; no real email, no Stripe, no marketplace invites or reminders, no activation emails.
export ENVIRONMENT=development
export SUPABASE_URL="${LOCAL_SUPABASE_URL:?set LOCAL_SUPABASE_URL}" SUPABASE_SERVICE_ROLE_KEY="${LOCAL_SUPABASE_SERVICE_KEY:?set LOCAL_SUPABASE_SERVICE_KEY}"
export PUBLIC_SUPABASE_URL="" SUPABASE_SERVICE_ROLE=""
export MONGO_URL="mongodb://127.0.0.1:1" MONGO_URI="mongodb://127.0.0.1:1"
export SENDGRID_API_KEY="" RESEND_API_KEY=""
export STRIPE_LIVE_KEY="" STRIPE_SECRET_KEY="" STRIPE_PUBLISHABLE_KEY="" STRIPE_CONNECT_CLIENT_ID="" STRIPE_WEBHOOK_SECRET=""
export MARKETPLACE_CLAIM_INVITES_ENABLED=false MARKETPLACE_CLAIM_REMINDERS_ENABLED=false
export ACTIVATION_EMAILS_ENABLED=false ACTIVATION_DRY_RUN=true

# The transactional welcome has its own switch in the integrated app.
export WELCOME_EMAILS_ENABLED=false
