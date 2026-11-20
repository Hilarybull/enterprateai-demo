# Tender sync settings and repeat imports

Migration `057_tender_sync_preferences.sql` adds the admin-selected interval (5–1440 minutes, default 180) and new-listing scope (`suitable` by default, or `all`). Apply it after migrations 051–056 before using the new controls. Without it, the settings form is disabled and the existing importer continues working.

The interval is the minimum time between automatic attempts, including catch-up runs. The scheduler checks every five minutes, so actual starts may be up to five minutes later. Manual sync bypasses the interval but respects an active lease and source retry delays. An active run snapshots its scope; changing settings affects subsequent runs. Only the protected system-admin API can change settings.

The source feed documents publication/update windows, stages and identifiers, but no SME-only request parameter. SME selection therefore uses the buyer's explicit `suitability.sme` flag before creating new Marketplace listings. The source releases are retained for history. Unknown suitability does not count as suitable. Updates and closure markers remain available regardless of scope, preventing old saved listings from becoming stale. Changing scope does not delete existing listings or rewind the source checkpoint; releases encountered again can be projected under the broader scope.

Listings remain unique by procurement and lot; separate lots are separate opportunities. Source versions are recorded once, and repeated imports update the same listing. Identical versions leave the listing's observed timestamp unchanged. Newer notice dates replace existing details, deadlines and status; older releases cannot overwrite them. Whole-process closure prevents an older notice from reopening the process. Failed partial runs retain their checkpoint and safely replay already committed pages.

Verification:

- `python -m pytest tests/test_tender_sync_preferences.py tests/test_public_tenders.py -q` from `backend`: 23 passed.
- `npx vitest run src/components/admin/TenderSyncAdmin.test.jsx --pool=threads --maxWorkers=1 --minWorkers=1` from `frontend`: 3 passed; includes preserving edits during status polling.
- `node backend/tests/tender_sync_database.cjs <installed @electric-sql/pglite path>`: temporary PostgreSQL checks for duplicate pages, repeated imports, updates without SME flags, stale notice ordering, closures, scope changes, distinct lots, lease protection, interval enforcement, permissions and repeated migration application. No live database is used.

Source documentation: https://www.gov.uk/government/publications/open-contracting and https://www.find-tender.service.gov.uk/apidocumentation/1.0/GET-ocdsReleasePackages.
