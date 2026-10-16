/* Live browser verification; requires Playwright (not needed to run the app).
 * Run: PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-smoke.cjs
 * Start the local server from README.md first. Screenshots go to /tmp.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.BIOATLAS_URL || 'http://127.0.0.1:8767';
const output = '/private/tmp/bioatlas-qa';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BIOATLAS_CHROMIUM_EXECUTABLE ? { executablePath: process.env.BIOATLAS_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function settled() { await page.locator('#record-list[aria-busy="false"]').waitFor({ timeout: 35000 }); }
  async function submit() { await page.getByRole('button', { name: 'Explore records', exact: true }).click(); await settled(); }
  await page.goto(base); await page.locator('.hero-specimen img').evaluate(img => img.decode());
  await page.screenshot({ path: `${output}/portfolio-desktop.png`, fullPage: true });
  await page.getByRole('link', { name: 'Start exploring' }).click(); await settled();
  assert.ok(await page.locator('.record-card').count() > 0, 'Live GBIF records rendered');
  assert.equal(await page.locator('#request-message').isVisible(), false, 'No API warning on first load');
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${output}/explorer-desktop.png`, fullPage: true });
  console.log('PASS: live API, map and initial desktop render');
  const firstName = await page.locator('.record-open h3').first().textContent();
  await page.locator('.save-record').first().click(); assert.equal(await page.locator('#saved-count').textContent(), '1');
  await page.reload(); await settled(); assert.equal(await page.locator('#saved-count').textContent(), '1');
  await page.locator('#shortlist-toggle').click(); assert.equal(await page.locator('.record-card').count(), 1);
  await page.locator('.record-open').first().click(); await page.locator('#record-dialog[open]').waitFor();
  assert.equal(await page.locator('#detail-title').textContent(), firstName);
  await page.screenshot({ path: `${output}/record-detail.png` }); await page.keyboard.press('Escape');
  await page.locator('#back-to-results').click();
  console.log('PASS: saving, reload persistence, shortlist and source details');
  await page.locator('#next-page').click(); await settled(); assert.match(await page.locator('#results-summary').textContent(), /61–120/);
  await page.locator('#previous-page').click(); await settled(); assert.match(await page.locator('#results-summary').textContent(), /1–60/);
  console.log('PASS: next and previous pages use real GBIF records');
  await page.locator('#year-from').fill('2025'); await page.locator('#year-to').fill('2020'); await submit();
  assert.match(await page.locator('#form-error').textContent(), /starting year/);
  await page.locator('#year-from').fill('2020'); await page.locator('#year-to').fill('2024');
  await page.locator('#area-select').selectOption('mindanao');
  await page.locator('#species-input').fill('Lanius schach');
  await page.locator('#species-options[hidden]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  const option = page.getByRole('option', { name: /^Lanius schach/ }).first();
  if (await option.count()) await option.click();
  await submit();
  assert.equal(await page.locator('#request-message').isVisible(), false);
  assert.match(await page.locator('#active-scope').textContent(), /Mindanao area/);
  assert.match(await page.locator('#active-scope').textContent(), /2020–2024/);
  assert.ok(await page.locator('.record-card').count() > 0);
  console.log('PASS: scientific-name, location and year filters');
  await page.route('https://api.gbif.org/v1/occurrence/search?**', route => route.abort('internetdisconnected'));
  await submit(); assert.equal(await page.locator('#request-message').isVisible(), true);
  assert.match(await page.locator('#request-message').textContent(), /Previous results/);
  await page.unroute('https://api.gbif.org/v1/occurrence/search?**');
  await page.locator('#retry-search').click(); await settled(); assert.equal(await page.locator('#request-message').isVisible(), false);
  console.log('PASS: network failure preserves data and retry recovers');
  await page.route('https://api.gbif.org/v1/occurrence/search?**', route => route.fulfill({ json: { count: 0, results: [], endOfRecords: true } }));
  await submit(); assert.match(await page.locator('.empty-state').textContent(), /No records/);
  assert.match(await page.locator('#map-count').textContent(), /0 page records/);
  await page.unroute('https://api.gbif.org/v1/occurrence/search?**');
  await page.locator('#reset-filters').click(); await settled();
  console.log('PASS: empty results clear markers and offer useful guidance');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
  await page.screenshot({ path: `${output}/explorer-mobile.png`, fullPage: true });
  await page.locator('[data-view="map"]').click(); await page.waitForTimeout(700);
  assert.equal(await page.locator('.map-panel').isVisible(), true);
  await page.screenshot({ path: `${output}/map-mobile.png`, fullPage: true });
  await page.goto(base); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/portfolio-mobile.png`, fullPage: true });
  console.log('PASS: mobile layout, map/list toggle and portfolio');
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  await browser.close();
  console.log(`All browser checks passed. Screenshots: ${output}`);
})().catch(error => { console.error(error); process.exit(1); });
