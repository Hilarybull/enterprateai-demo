import { expect, test } from '@playwright/test';

test('automatic controls and paginated history fit mobile, tablet and desktop', async ({ page }) => {
  await page.route('**/public-tenders/admin/health', route => route.fulfill({ json: {
    scheduled: false, preferences_configurable: true, interval_minutes: 180, import_scope: 'suitable',
    history_available: true, stale: false, last_sync: '2026-11-20T12:00:00Z',
    last_attempt: '2026-11-20T11:59:00Z', checkpoint: '2026-11-20T12:00:00Z'
  } }));
  await page.route('**/public-tenders/admin/history?**', route => {
    const older = new URL(route.request().url()).searchParams.has('before');
    return route.fulfill({ json: { items: Array.from({ length: older ? 3 : 10 }, (_, i) => ({
      attempted_at: `2026-11-${older ? '18' : '20'}T${String(10 - i).padStart(2, '0')}:00:00Z`,
      status: i % 2 ? 'failed' : 'succeeded',
      error: i % 2 ? 'The source could not be reached. Please try again later.' : null,
      summary: i % 2 ? null : { imported: 129, quarantined: 2, pages: 3 }
    })), more: !older, next_before: older ? null : '2026-11-20T01:00:00Z' } });
  });
  await page.goto('/e2e/tender-sync-settings.html');
  const toggle = page.getByRole('switch', { name: 'Automatic sync' });
  await expect(toggle).toBeVisible();
  await expect(page.getByLabel('Sync interval (minutes)', { exact: false })).toHaveCount(0);
  await toggle.click();
  await expect(page.getByLabel('New tenders to include')).toHaveValue('suitable');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole('button', { name: 'Save sync settings' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(page.locator('ul > li')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.locator('ul > li')).toHaveCount(10);
  await toggle.click();
  await expect(page.getByLabel('New tenders to include')).toHaveCount(0);
});
