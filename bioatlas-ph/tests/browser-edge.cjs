const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.BIOATLAS_URL || 'http://127.0.0.1:8767';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BIOATLAS_CHROMIUM_EXECUTABLE ? { executablePath: process.env.BIOATLAS_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const settled = () => page.locator('#record-list[aria-busy="false"]').waitFor({ timeout: 35000 });
  await page.goto(`${base}/app.html`); await settled();
  await page.locator('#species-input').fill('Lanius');
  await page.getByRole('option').first().waitFor({ timeout: 15000 });
  await page.locator('#species-input').press('ArrowDown');
  await page.locator('#species-input').press('Enter');
  assert.ok((await page.locator('#species-input').inputValue()).startsWith('Lanius '));
  assert.equal(await page.locator('#species-options').isVisible(), false);
  console.log('PASS: live suggestions and keyboard selection');
  await page.locator('#reset-filters').click(); await settled();
  await page.locator('[data-group="birds"]').click(); await settled();
  assert.ok(await page.locator('.record-card').count() > 0);
  assert.equal(await page.locator('.record-category').first().textContent(), 'Birds');
  const queryPromise = page.waitForRequest(req => req.url().includes('/occurrence/search?') && req.url().includes('geometry='));
  await page.locator('#search-map').click();
  const mapQuery = new URL((await queryPromise).url()); await settled();
  assert.equal(mapQuery.searchParams.get('country'), 'PH'); assert.match(mapQuery.searchParams.get('geometry'), /^POLYGON/);
  console.log('PASS: taxon groups and current-map-area search');
  await page.locator('.record-open').first().click();
  await page.locator('.detail-photo').evaluate(img => img.decode()).catch(() => {});
  await page.screenshot({ path: '/private/tmp/bioatlas-qa/record-detail-final.png' });
  await page.keyboard.press('Escape');

  // Controlled fixture responses exercise races and untrusted publisher text.
  // These responses exist only inside the test; the app has no fixture fallback.
  let sequence = 0;
  await page.route('https://api.gbif.org/v1/occurrence/search?**', async route => {
    const n = ++sequence;
    if (n === 1) await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({ json: { count: 1, endOfRecords: true, results: [{ key: n, species: n === 1 ? 'Old request' : '<img src=x onerror="window.injected=true">', kingdom: 'Plantae', decimalLatitude: 8.95, decimalLongitude: 125.54, eventDate: '2024-01-10', year: 2024 }] } }).catch(() => {});
  });
  await page.locator('[data-group="plants"]').click();
  await page.locator('[data-group="mammals"]').click(); await settled(); await page.waitForTimeout(750);
  assert.equal(await page.locator('.record-card').count(), 1);
  assert.match(await page.locator('.record-open h3').textContent(), /<img/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('.record-open img').count(), 0);
  console.log('PASS: old requests cannot overwrite new results; publisher text is inert');
  await page.unroute('https://api.gbif.org/v1/occurrence/search?**');
  await page.evaluate(() => localStorage.setItem('bioatlas-ph.shortlist.v1', JSON.stringify([{ id: '23', name: 'Bad record', place: 'PH', group: 'birds', photo: null, date: {} }])));
  await page.reload(); await settled(); assert.equal(await page.locator('#saved-count').textContent(), '0');
  console.log('PASS: malformed saved data is safely ignored');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
  }
  assert.deepEqual(errors, []);
  await browser.close(); console.log('All edge checks passed.');
})().catch(error => { console.error(error); process.exit(1); });
