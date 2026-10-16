const test = require('node:test');
const assert = require('node:assert/strict');
const { validateYears, buildParams, geometry, normalizeRecord, coordinatesValid, safeURL, licenseLabel, validSavedRecord } = require('../script.js');

test('year validation rejects reversed, fractional, out-of-range and future years', () => {
  for (const [start, end] of [['2024','2020'],['2020.5',''],['1599',''],['','2030']]) assert.throws(() => validateYears(start, end, 2026));
  assert.deepEqual(validateYears('', '2024', 2026), { from: null, to: 2024 });
  assert.deepEqual(validateYears('2020', '2020', 2026), { from: 2020, to: 2020 });
});
test('every geographic query stays in PH, excludes flagged coordinates and preserves pagination', () => {
  const query = buildParams({ group: 'birds', area: 'mindanao', photos: true, from: 2020, to: 2024 }, 60);
  assert.equal(query.get('country'), 'PH'); assert.equal(query.get('hasGeospatialIssue'), 'false');
  assert.equal(query.get('taxonKey'), '212'); assert.equal(query.get('offset'), '60');
  assert.equal(query.get('year'), '2020,2024'); assert.equal(query.get('mediaType'), 'StillImage');
  assert.equal(query.get('geometry'), 'POLYGON((121 4.5,127 4.5,127 10.6,121 10.6,121 4.5))');
});
test('an explicit species overrides the broad group and photos can be omitted', () => {
  const query = buildParams({ group: 'birds', taxon: { key: 123 }, area: 'all', photos: false });
  assert.equal(query.get('taxonKey'), '123'); assert.equal(query.has('mediaType'), false); assert.equal(query.has('geometry'), false);
});
test('the GBIF search ceiling is enforced, including a partial last page', () => {
  assert.throws(() => buildParams({ group: 'all' }, 100000));
  assert.throws(() => buildParams({ group: 'all' }, -1));
  assert.equal(buildParams({ group: 'all' }, 99960).get('limit'), '40');
});
test('invalid map bounds are rejected before reaching GBIF', () => {
  assert.throws(() => geometry([127, 5, 121, 10])); assert.throws(() => geometry([120, 5, NaN, 10]));
});
test('missing coordinates do not become a false point at zero and missing metadata remains explicit', () => {
  const record = normalizeRecord({ key: 42, scientificName: 'Unknown species', decimalLatitude: null });
  assert.equal(record.lat, null); assert.equal(record.lng, null); assert.equal(coordinatesValid(record.lat, record.lng), false);
  assert.equal(record.recordedBy, 'Not supplied'); assert.equal(record.photo, null); assert.equal(record.uncertainty, null);
});
test('source and photo URLs cannot contain executable schemes', () => {
  assert.equal(safeURL('javascript:alert(1)'), ''); assert.equal(safeURL('data:text/html,test'), '');
  assert.equal(safeURL('http://creativecommons.org/licenses/by/4.0/'), 'https://creativecommons.org/licenses/by/4.0/');
});
test('photo licence versions and conditions are preserved', () => {
  assert.equal(licenseLabel('https://creativecommons.org/licenses/by-nc-sa/3.0/'), 'CC BY-NC-SA 3.0');
  assert.equal(licenseLabel('https://creativecommons.org/licenses/by/4.0/'), 'CC BY 4.0');
  assert.equal(licenseLabel('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
});
test('malformed stored records are ignored instead of breaking the explorer', () => {
  const record = normalizeRecord({ key: 12, species: 'Lanius schach' });
  assert.equal(validSavedRecord(record), true);
  assert.equal(validSavedRecord({ ...record, date: {} }), false);
  assert.equal(validSavedRecord({ ...record, issues: 'broken' }), false);
  assert.equal(validSavedRecord({ ...record, photo: { url: 'javascript:alert(1)' } }), false);
});
