# Local conversation flow changes

These changes are local only. They have not been committed or pushed to demo staging.

The Agent Centre keeps specialist work in its current conversation. Funding, launch, idea and legacy specialist replies no longer trigger a navigation or copy the exchange into a separate case chat. Questions, result cards, approvals and contextual actions remain in the main thread. The model is instructed to use one voice and recommend next steps when useful rather than forcing a task after every greeting or explanation.

Funding and launch workspaces remain available through explicit actions. Requests switching between specialist topics on a module page are delegated in place; a funding case ID is never passed as a launch plan ID. Customer, risk and pricing checks use the same conversation instead of embedding another composer. Existing check messages in saved history offer “Continue this check here” rather than recreating their old chat widget. If a specialist cannot answer, the main thread reports that and remains usable.

Tender lists now show available page numbers, the current page and total pages, with wrapping controls for narrow screens. Guests see “Save to watchlist”; clicking it opens the existing sign-in page and preserves the selected tender and filters in the return link. Signed-in users save directly.

Verified locally:

- 64 backend conversation and tool checks passed, including follow-ups, explicit approvals, changing task and specialist routing.
- 29 component checks passed, including one composer, legacy responses, topic switches, numbered pages and guest/signed-in watchlist behavior.
- Local frontend production build passed. Existing CSS/minification and bundle-size warnings remain.

The funding API fixtures disable startup database connections and background schedulers so their in-memory tests do not wait on external snapshot services. No live model, payment or database write is used by these tests.

## Documents, research and downloads

The main conversation can list and read business uploads, search the web through the configured search provider, read public source pages, and generate private PDF and Excel downloads when requested. Uploading a general chat document no longer requires starting a funding-readiness case. Text PDFs, Word documents, Excel saved values, CSV and text files are supported with explicit size and reading limits. Scanned or image-only content reports that its text cannot be read; OCR is not included. Generated Excel files retain supported local formulas; the server does not calculate formula values.

Files are stored privately and downloads require an authenticated business member with document access. Saved chat cards retain file references, so downloads remain available when the conversation is reopened. Uploaded content and web text are treated as source data, rather than instructions. Search failures are reported rather than presented as successful research.

Landing-page handoffs were checked for signed-in users and guests completing sign-in. An existing-case lookup now continues in the Agent Centre, including after sign-in, with the original request and captured answers instead of returning to the dashboard or a separate specialist page.

Additional verification: 75 backend file/conversation checks, two upload-route checks and 73 frontend checks passed; the frontend production build passed. Search and model replies were simulated in tests; live provider availability and real email/Google sign-in were not exercised. Existing build warnings remain. All of this work remains local and unpushed.

## Quick-action consistency

The sidebar's Upload documents action opens the main chat's existing file picker. Chat upload actions follow the active business, and the Agent Centre remounts its chat when switching businesses so conversation state does not carry across businesses. Uploading marks the conversation active so a slow history restore cannot replace the upload message.

Connect data opens Integrations. Import requests now specify the selected business; the server checks access and write permissions, reads that business and pins all writes to the same ID throughout the import. The agent can look up the latest saved profile, summary and paginated trading/catalogue records instead of relying only on its initial compact context. Connected accounts contribute successfully imported records, not unrestricted live account access. Live provider credentials were not exercised by these checks.
