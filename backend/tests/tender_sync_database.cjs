// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite package.
const { PGlite } = require(process.argv[2] || process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of ['051_uk_public_tenders.sql', '052_tender_automatic_sync.sql', '053_tender_sync_history.sql', '057_tender_sync_preferences.sql']) {
    await db.exec(readFileSync(resolve(__dirname, '../migrations', file), 'utf8'));
  }
  // Re-applying an upgrade must be safe too.
  await db.exec(readFileSync(resolve(__dirname, '../migrations/057_tender_sync_preferences.sql'), 'utf8'));
  const lease = '11111111-1111-4111-8111-111111111111';
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  assert.equal(await scalar('select import_scope from fts_sync'), 'suitable', 'SME suitability is the default without admin configuration');
  const acquire = (time, manual = false, id = lease) => db.query('select * from fts_acquire($1, $2, $3)', [id, time, manual]);
  const now = new Date();
  await db.exec('update fts_sync set interval_minutes=60');
  assert.equal((await acquire(now)).rows.length, 1);
  assert.equal((await acquire(now, true, '22222222-2222-4222-8222-222222222222')).rows.length, 0, 'no concurrent lease');
  const row = (version, date, details = {}, id = 'p:lot:1', closed = false, stage = 'open') => ({
    version_id: version, notice_id: version, ocid: id.split(':')[0], payload: { version }, listings: [{
      id, published_at: date, stage, deadline: '2026-12-18T12:00:00Z', whole_process_closed: closed,
      details: { title: 'Grounds maintenance', sme_suitable: true, ...details }
    }]
  });
  const apply = (rows) => scalar('select fts_apply_page($1, $2::jsonb)', [lease, JSON.stringify(rows)]);
  const first = row('001', '2026-11-01T12:00:00Z');
  assert.equal(await apply([first, first]), 1, 'duplicate in one page counts once');
  const observed = await scalar("select observed_at from fts_listings where id='p:lot:1'");
  assert.equal(await apply([first]), 0, 'retry/repeated import does not add history');
  assert.equal((await scalar("select observed_at from fts_listings where id='p:lot:1'")).toISOString(), observed.toISOString(), 'identical import is a no-op');
  assert.equal(Number(await scalar('select count(*) from fts_listings')), 1);
  assert.equal(Number(await scalar('select count(*) from fts_release_history')), 1);

  const revised = row('002', '2026-11-02T12:00:00Z', { title: 'Updated scope', sme_suitable: null });
  revised.listings[0].deadline = '2026-12-20T12:00:00Z';
  await apply([revised]);
  assert.equal(await scalar("select details->>'title' from fts_listings where id='p:lot:1'"), 'Updated scope', 'existing tenders update even without an SME flag');
  assert.equal((await scalar("select deadline from fts_listings where id='p:lot:1'")).toISOString(), '2026-12-20T12:00:00.000Z');
  await apply([first]);
  assert.equal(await scalar("select details->>'title' from fts_listings where id='p:lot:1'"), 'Updated scope', 'older replay cannot overwrite a newer version');
  await apply([row('003', '2026-11-02T12:00:00Z', { sme_suitable: false }, 'p:lot:2')]);
  assert.equal(Number(await scalar('select count(*) from fts_listings')), 1, 'SME scope skips new non-SME listings');
  // Saving different preferences cannot change an in-flight run's scope.
  await db.exec("update fts_sync set import_scope='all'");
  await apply([row('004', '2026-11-02T12:00:00Z', { sme_suitable: false }, 'p:lot:3')]);
  assert.equal(Number(await scalar('select count(*) from fts_listings')), 1);
  const excluded = row('008', '2026-11-02T12:00:00Z', { sme_suitable: false }, 'other:lot:2');
  await apply([excluded]);
  await apply([row('005', '2026-11-03T12:00:00Z', { sme_suitable: null }, 'p:process', true, 'closed')]);
  assert.equal(await scalar("select stage from fts_listings where id='p:lot:1'"), 'closed', 'whole-process closure updates existing lots');
  await apply([row('006', '2026-11-02T15:00:00Z', {}, 'p:lot:4')]);
  assert.equal(Number(await scalar("select count(*) from fts_listings where stage='open'")), 0, 'older notices cannot reopen a closed process');
  // Separate lots are intentional separate opportunities, not duplicates.
  await db.exec("update fts_sync set lease_id=null, lease_until=null, last_success=last_attempt");
  assert.equal((await acquire(new Date(now.getTime() + 59 * 60000))).rows.length, 0, 'honors configured cadence while catching up');
  // Manual sync can bypass cadence but still respects retry and lease protection.
  await db.exec("update fts_sync set retry_at=now()+interval '10 minutes'");
  assert.equal((await acquire(now, true)).rows.length, 0);
  await db.exec('update fts_sync set retry_at=null');
  assert.equal((await acquire(new Date(now.getTime() + 60 * 60000))).rows.length, 1);
  assert.equal(await scalar('select active_import_scope from fts_sync'), 'all');
  await apply([excluded]);
  assert.equal(Number(await scalar("select count(*) from fts_listings where id='other:lot:2'")), 1, 'replayed stored history can project a listing after scope broadens');
  await apply([row('007', '2026-11-04T12:00:00Z', {}, 'other:lot:3')]);
  assert.equal(Number(await scalar("select count(*) from fts_listings where id like 'other:%'")), 2);
  assert.equal(await scalar("select has_function_privilege('authenticated','fts_apply_page(uuid,jsonb)','execute')"), false);
  await assert.rejects(() => db.exec('update fts_sync set interval_minutes=1'));
  await db.close();
  console.log('Passed database checks: repeat imports, retries, updates, scope, closure ordering, distinct lots, lease, cadence, permissions and migration replay.');
})().catch(error => { console.error(error); process.exitCode = 1; });
