# Signup and profile-claim welcome email

Subject: **Welcome to EnterprateAI - Get Discovered. Win Business. Grow.**

The shared HTML/plain-text template is `app/modules/activation/welcome.py`. It uses the user's first name, the five product benefits, Patrick's signature and a styled **Click to Login** button linking to `https://www.enterprate.ai/dashboard`.

Set `WELCOME_EMAILS_ENABLED=true` on each deployed backend and restart it. This enables welcome messages from verified signup and successful profile-claim events for all eligible accounts. It does not enable promotional campaigns, change marketing permission, or send previously queued preview welcomes to other accounts. The activation scheduler must be running, migration 033 must be present, and `RESEND_API_KEY` / `RESEND_FROM_EMAIL` must be configured.

Password/email verification, Google signup, landing email-code signup, invitation signup and approved marketplace claims queue the same W/w1 ledger entry. The unique user/journey/step key prevents a signup followed by a claim from sending two welcomes. An unsent preview is promoted only when that particular user completes a new signup/claim event. Sent or uncertain entries are never replaced to force another send.

The scheduler wakes after a new entry is saved. Provider calls run outside the signup/claim response. Failed deliveries retry through the existing ledger and use the same provider idempotency key. A suppressed or unverified address does not receive the welcome. An explicit delivery preview (`dry_run=True`) never sends.

Local verification covers both message formats, escaping, exact subject, button, signup/claim hooks, retries, duplicate prevention and the independent delivery switch. Inbox delivery requires a real future signup/claim; the automated tests do not send real emails.
