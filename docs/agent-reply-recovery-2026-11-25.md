# Agent recovery fixes — 25 November 2026

Four new regression tests first reproduced lost POST acknowledgements, missing recovery after refresh, lost failed-message context and a late reply crossing into another signed-in account. They now pass.

## Changes

- Save the request identifier before sending. If all acknowledgement attempts fail, look up the accepted server job using that same identifier instead of submitting a new request. Browser storage holds identifiers only, without conversation text.
- Recover by request identifier after refresh, retaining the original message and conversation. The server lookup remains private to the requesting user and checks business access.
- Failed jobs return their original message and conversation. “Edit and retry” places that message in the composer for review; it does not send or restart work automatically.
- Stop polling when the signed-in account changes, including browser-data clearing. A late response cannot populate another account's conversation memory.
- Bound a pending reply check to four minutes. Keep its recovery reference and offer “Check reply” rather than spinning indefinitely. Invalid or empty reply responses also retain recovery controls.
- An empty handler result becomes a visible recoverable failure rather than an empty successful reply.

Completed jobs and duplicate request identifiers continue to use the existing saved result; this change does not automatically execute failed jobs again.

## Verification

- 67 backend checks passed: reply-job ownership and idempotency, HTTP recovery lookup, interrupted/empty replies, intake retries, signed handover, retained funding answers, readiness controls and saved research.
- 125 frontend checks passed: agent chat, lost acknowledgements, recovery after refresh, account switching, bounded polling, invalid responses, task questions, approval safeguards, readiness drafts and signed handovers.
- Production build passed.
- Isolated Chromium checks passed at 1440, 390 and 768 pixels with synthetic data and intercepted API responses. Three lost-acknowledgement POST attempts used one request identifier. Refresh and “Edit and retry” generated no new request. No browser errors or page overflow were observed.

A minimal live gateway probe using the local backend configuration returned the expected READY response through Anthropic (`claude-opus-5-5`). The recovery browser scenarios use intercepted API responses; the provider probe independently checks that the configured live AI service can answer. No live business records were changed by this verification.

## Agent presentation and responsive layout

- Added a conversation heading and consistent spacing, rounded cards, brand-colour actions and visible keyboard focus.
- Readiness summaries stack their action beneath the text on phones. Long words and references wrap inside the chat column.
- Enlarged primary chat controls and suggestions to 44-pixel touch targets. Phone inputs use 16-pixel text to avoid automatic zoom; the composer respects the safe area.
- Removed the extra outer readiness border on phones, leaving more room for the review and work cards. Suggested replies have a bounded scrolling area so they cannot push the composer off screen.
- “Edit and retry” now focuses the restored message for review, without submitting it. Reduced-motion preferences disable chat animations.
- Verified rich replies, draft approval controls, readiness choices and the actual Agent Centre with synthetic API responses at 390, 768 and 1440 pixels. No page or chat horizontal overflow or browser errors; composer remains visible; mobile/tablet task sheets open and close.
- These checks use an isolated local preview, not production records or a deployed end-to-end session.
- The “AI” suffix in the Agent Centre heading and shared agent identity uses the existing brand red (`#f3043f`), defined once as `--brand-red`; image logos retain their original branding. Browser checks assert the computed heading colour. The 58 chat/readiness checks and 15 shared-card/greeting checks passed (12 of the latter overlap).
