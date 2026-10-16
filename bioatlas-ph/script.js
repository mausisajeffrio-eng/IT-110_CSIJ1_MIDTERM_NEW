/* BioAtlas PH — ordinary browser JavaScript, organized by responsibility.
 * 1. Pure data helpers  2. State & requests  3. Rendering  4. Event handlers
 * API documentation: https://techdocs.gbif.org/en/openapi/
 * Map libraries in assets/vendor retain their own licences.
 */
(() => {
  'use strict';

  const API = 'https://api.gbif.org/v1'; //API provides the GBIF server address.
  const PAGE_SIZE = 60;
  const SEARCH_LIMIT = 100000;
  const STORAGE_KEY = 'bioatlas-ph.shortlist.v1';
  const GROUPS = {
    all: { label: 'All life', key: null },
    birds: { label: 'Birds', key: 212 },
    plants: { label: 'Plants', key: 6 },
    mammals: { label: 'Mammals', key: 359 },
    insects: { label: 'Insects', key: 216 }
  };
  // [west, south, east, north]. These are intentionally described as areas,
  // not exact administrative boundaries. country=PH is always also applied.
  const AREAS = {
    all: { label: 'Philippines', bounds: null },
    luzon: { label: 'Luzon area', bounds: [119.3, 12.5, 124.6, 19.5] },
    visayas: { label: 'Visayas area', bounds: [121, 9, 126.5, 12.8] },
    mindanao: { label: 'Mindanao area', bounds: [121, 4.5, 127, 10.6] },
    palawan: { label: 'Palawan area', bounds: [116.5, 7.5, 121, 12.5] }
  };
  const cleanText = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const safeURL = value => {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      url.protocol = 'https:';
      return url.href;
    } catch { return ''; }
  };
  const coordinatesValid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  function validateYears(from, to, currentYear = new Date().getFullYear()) {
    const values = [from, to].map(value => String(value ?? '').trim());
    for (const value of values) {
      if (value && (!/^\d{4}$/.test(value) || Number(value) < 1600 || Number(value) > currentYear)) {
        throw new Error(`Use a four-digit year from 1600 to ${currentYear}.`);
      }
    }
    const start = values[0] ? Number(values[0]) : null;
    const end = values[1] ? Number(values[1]) : null;
    if (start && end && start > end) throw new Error('The starting year must be earlier than or equal to the ending year.');
    return { from: start, to: end };
  }
  function geometry(bounds) {
    const [west, south, east, north] = bounds;
    if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north || south < -90 || north > 90 || west < -180 || east > 180) throw new Error('Choose a valid map area within the Philippines.');
    return `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;
  }
  function buildParams(filters, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= SEARCH_LIMIT) throw new Error('Narrow your search to browse more records.');
    const params = new URLSearchParams({ country: 'PH', hasCoordinate: 'true', hasGeospatialIssue: 'false', limit: String(Math.min(PAGE_SIZE, SEARCH_LIMIT - offset)), offset: String(offset) });
    const key = filters.taxon?.key || GROUPS[filters.group]?.key;
    if (key) params.set('taxonKey', String(key));
    if (filters.photos) params.set('mediaType', 'StillImage');
    if (filters.from || filters.to) params.set('year', `${filters.from || 1600},${filters.to || new Date().getFullYear()}`);
    const bounds = filters.area === 'map' ? filters.bounds : AREAS[filters.area]?.bounds;
    if (bounds) params.set('geometry', geometry(bounds));
    return params;
  }
  function groupFor(record) {
    if (record.class === 'Aves') return 'birds';
    if (record.kingdom === 'Plantae') return 'plants';
    if (record.class === 'Mammalia') return 'mammals';
    if (record.class === 'Insecta') return 'insects';
    return 'other';
  }
  function normalizeRecord(raw) {
    const media = Array.isArray(raw.media) ? raw.media.find(m => m.type === 'StillImage' && safeURL(m.identifier)) : null;
    return {
      id: String(raw.key), name: cleanText(raw.species, cleanText(raw.scientificName, 'Unidentified taxon')),
      commonName: cleanText(raw.vernacularName), group: groupFor(raw),
      lat: typeof raw.decimalLatitude === 'number' ? raw.decimalLatitude : null,
      lng: typeof raw.decimalLongitude === 'number' ? raw.decimalLongitude : null,
      date: cleanText(raw.eventDate), year: Number.isInteger(raw.year) ? raw.year : null,
      place: cleanText(raw.stateProvince, cleanText(raw.locality, 'Philippines · locality not supplied')),
      locality: cleanText(raw.locality), province: cleanText(raw.stateProvince),
      type: cleanText(raw.basisOfRecord, 'UNKNOWN'), dataset: cleanText(raw.datasetName, 'Dataset name not supplied'),
      recordedBy: cleanText(raw.recordedBy, 'Not supplied'), license: safeURL(raw.license),
      uncertainty: Number.isFinite(raw.coordinateUncertaintyInMeters) ? raw.coordinateUncertaintyInMeters : null,
      issues: Array.isArray(raw.issues) ? raw.issues.filter(x => typeof x === 'string') : [],
      withheld: cleanText(raw.informationWithheld), generalizations: cleanText(raw.dataGeneralizations),
      photo: media ? { url: safeURL(media.identifier), creator: cleanText(media.creator, cleanText(media.rightsHolder, 'Creator not supplied')), license: safeURL(media.license), source: safeURL(media.references) } : null
    };
  }
  function validSavedRecord(record) {
    return Boolean(record && /^\d+$/.test(record.id)
      && ['name', 'place', 'date', 'type', 'dataset', 'recordedBy', 'license'].every(key => typeof record[key] === 'string')
      && ['birds','plants','mammals','insects','other'].includes(record.group)
      && (record.uncertainty === null || Number.isFinite(record.uncertainty))
      && Array.isArray(record.issues) && record.issues.every(value => typeof value === 'string')
      && (record.photo === null || (record.photo && safeURL(record.photo.url))));
  }
  function licenseLabel(url) {
    if (!url) return 'Not supplied';
    const match = url.match(/creativecommons\.org\/licenses\/([a-z-]+)\/(\d+(?:\.\d+)?)\//i);
    if (match) return `CC ${match[1].toUpperCase()} ${match[2]}`;
    if (/creativecommons\.org\/publicdomain\/zero\//i.test(url)) return 'CC0';
    return 'View licence';
  }
  // Expose only pure helpers to the small Node test suite; no build is required.
  if (typeof module !== 'undefined' && module.exports) module.exports = { validateYears, geometry, buildParams, normalizeRecord, coordinatesValid, safeURL, licenseLabel, validSavedRecord };
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const state = { group: 'all', taxon: null, records: [], count: 0, offset: 0, end: true, applied: null, saved: [], view: 'results', loading: false, requestId: 0, controller: null, mapBounds: null, selected: null };
  let map, clusters, suggestionController, suggestionTimer, suggestions = [], suggestionIndex = -1, suggestionRequest = 0, toastTimer;
  const markers = new Map();
  const formatNumber = number => new Intl.NumberFormat('en-PH').format(number);
  const humanType = type => ({ HUMAN_OBSERVATION: 'Observation', PRESERVED_SPECIMEN: 'Specimen', MATERIAL_SAMPLE: 'Sample', MACHINE_OBSERVATION: 'Machine observation', FOSSIL_SPECIMEN: 'Fossil', LIVING_SPECIMEN: 'Living specimen' }[type] || 'Occurrence');
  const readableDate = record => {
    if (!record.date) return record.year ? String(record.year) : 'Date not supplied';
    // Keep the published calendar date, without shifting it between time zones.
    const match = record.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return record.date;
    return new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  };
  const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const externalLink = (text, url, className = '') => { const node = element('a', className, text); node.href = safeURL(url); node.target = '_blank'; node.rel = 'noopener'; return node; };
  const bookmarkSVG = '<svg viewBox="0 0 20 24" aria-hidden="true"><path d="M4 3h12v18l-6-4-6 4V3Z"/></svg>';
  function announce(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
  }
  function readSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(value)) state.saved = value.filter(validSavedRecord).filter((item, index, items) => items.findIndex(r => r.id === item.id) === index).slice(0, 200);
    } catch { state.saved = []; announce('Your shortlist could not be read. You can still explore records.'); }
    updateSavedCount();
  }
  function updateSavedCount() { $('saved-count').textContent = state.saved.length; }
  const isSaved = id => state.saved.some(r => r.id === id);
  function saveRecord(record) {
    const existed = isSaved(record.id);
    if (!existed && state.saved.length >= 200) { announce('Your shortlist is full. Remove a record before saving another.'); return; }
    const next = existed ? state.saved.filter(r => r.id !== record.id) : [...state.saved, record];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { announce('This browser could not save your shortlist. Check its storage or privacy settings.'); return; }
    state.saved = next; updateSavedCount();
    document.querySelectorAll(`[data-save-id="${record.id}"]`).forEach(button => updateSaveButton(button, record));
    if (state.view === 'saved') renderResults(false);
    announce(existed ? 'Record removed from your shortlist.' : 'Record saved to your field shortlist.');
  }
  function updateSaveButton(button, record) {
    const saved = isSaved(record.id); button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${record.name}${saved ? ' from' : ' to'} shortlist`);
    button.title = saved ? 'Remove from shortlist' : 'Save to shortlist';
    if (button.classList.contains('detail-save')) button.textContent = saved ? 'Saved · remove from shortlist' : 'Save to field shortlist';
  }

  /*
fetch(url) — Sends an HTTP request to the URL, which points to the GBIF API endpoint.
await — Waits for the server's response before continuing.
const response — Stores the server's HTTP response.
signal — Allows the request to be cancelled if needed, such as when a newer search replaces an older one.
headers: { Accept: 'application/json' } — Tells the GBIF server that the client expects the response in JSON format.
  */
  // Every search is abortable. Older responses cannot overwrite newer criteria. Matches a scientific name to a GBIF species.
  async function fetchJSON(url, signal) {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } }); 
    if (!response.ok) {
      if (response.status === 429) throw new Error('GBIF is receiving many requests. Please wait a moment and try again.');
      throw new Error(`GBIF could not complete this request (${response.status}). Please try again.`);
    }
    return response.json();
  }
  function readFilters() {
    const years = validateYears($('year-from').value, $('year-to').value);
    return { ...years, query: $('species-input').value.trim(), taxon: state.taxon, group: state.group, area: $('area-select').value, photos: $('photos-only').checked, bounds: state.mapBounds };
  }
  function showError(message) {
    $('request-message').hidden = false;
    $('request-message').querySelector('span').textContent = `${message}${state.records.length ? ' Previous results are still shown.' : ''}`;
  }
  function setBusy(busy) {
    state.loading = busy; $('record-list').setAttribute('aria-busy', String(busy));
    $('previous-page').disabled = busy || state.offset === 0;
    $('next-page').disabled = busy || state.end || state.offset + PAGE_SIZE >= SEARCH_LIMIT;
    document.querySelector('.search-button').textContent = busy ? 'Searching…' : 'Explore records';
    if (busy && !state.records.length && state.view === 'results') renderLoading();
  }
  async function runSearch(options = {}) {
    let filters;
    $('form-error').hidden = true;
    for (const id of ['year-from', 'year-to', 'species-input']) $(id).removeAttribute('aria-invalid');
    try { filters = options.filters ? { ...options.filters } : readFilters(); }
    catch (error) {
      $('form-error').textContent = error.message; $('form-error').hidden = false;
      $('year-from').setAttribute('aria-invalid', 'true'); $('year-to').setAttribute('aria-invalid', 'true'); $('year-from').focus(); return;
    }
    const offset = options.offset || 0;
    state.controller?.abort(); const controller = new AbortController(); state.controller = controller;
    const requestId = ++state.requestId; let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    setBusy(true); $('request-message').hidden = true;
    try {
      if (filters.query && (!filters.taxon || filters.query !== filters.taxon.name)) {
        const match = await fetchJSON(`${API}/species/match?name=${encodeURIComponent(filters.query)}&strict=true`, controller.signal); //Matches a scientific name to a GBIF species.
        if (!match.usageKey || !['EXACT', 'FUZZY'].includes(match.matchType) || match.rank !== 'SPECIES') {
          throw new Error('Choose a species from the suggestions or enter its full scientific name.');
        }
        // A fuzzy response is offered as guidance, never silently substituted.
        if (match.matchType !== 'EXACT') throw new Error(`No exact species match. Did you mean ${match.canonicalName || match.scientificName}? Select it from the suggestions.`);
        filters.taxon = { key: match.usageKey, name: match.canonicalName || match.scientificName };
      }
      if (!filters.query) filters.taxon = null;
      const params = buildParams(filters, offset); 
      const data = await fetchJSON(`${API}/occurrence/search?${params}`, controller.signal); //Retrieves biodiversity occurrence records.
      if (!Array.isArray(data.results) || !Number.isFinite(data.count)) throw new Error('GBIF returned an unexpected response. Please try again.');
      if (requestId !== state.requestId) return;
      state.records = data.results.filter(r => /^\d+$/.test(String(r.key))).map(normalizeRecord);
      state.count = data.count; state.offset = offset; state.end = data.endOfRecords === true || offset + data.results.length >= data.count || data.results.length === 0;
      state.applied = filters; state.taxon = filters.taxon; state.selected = null;
      if (state.view === 'results') renderResults(true);
    } catch (error) {
      if (requestId !== state.requestId || (error.name === 'AbortError' && !timedOut)) return;
      const message = timedOut ? 'The request took too long. Please check your connection and try again.' : error instanceof TypeError ? 'Could not connect to GBIF. Check your internet connection and try again.' : error.message;
      showError(message);
      if (!state.records.length && state.view === 'results') {
        renderEmpty('The field atlas is taking a moment.', 'We could not load the records. Your filters are still here; use “Try again” above to retry.');
        $('results-summary').textContent = 'No records loaded.'; $('map-count').textContent = 'No records loaded';
      }
    } finally {
      clearTimeout(timeout);
      if (requestId === state.requestId) setBusy(false);
    }
  }

  function setupMap() {
    if (!window.L || !L.markerClusterGroup) {
      $('map-error').hidden = false; $('map-error').textContent = 'The map library could not load. You can still explore the record list.';
      $('search-map').disabled = true; $('fit-map').disabled = true; return;
    }
    map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: 17, maxBounds: [[-3, 108], [30, 140]], maxBoundsViscosity: .8, zoomAnimation: !matchMedia('(prefers-reduced-motion: reduce)').matches }).setView([12.3, 122.1], 5);
    L.control.zoom({ position: 'topleft' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
      .on('tileerror', () => { $('map-error').hidden = false; $('map-error').textContent = 'Some map tiles could not load. Record data and the list remain available.'; })
      .on('load', () => { /* Keep any tile warning visible rather than hiding a partial failure. */ }).addTo(map);
    clusters = L.markerClusterGroup({ maxClusterRadius: 42, showCoverageOnHover: false, spiderfyOnMaxZoom: true, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      iconCreateFunction: cluster => L.divIcon({ html: String(cluster.getChildCount()), className: 'cluster-marker', iconSize: [38, 38] }) });
    map.addLayer(clusters);
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
  }
  function visibleRecords() { return state.view === 'saved' ? state.saved : state.records; }
  function renderMap(fit) {
    const records = visibleRecords().filter(r => coordinatesValid(r.lat, r.lng));
    $('map-count').textContent = `${formatNumber(records.length)} ${state.view === 'saved' ? 'saved' : 'page'} records mapped`;
    if (!map) return;
    clusters.clearLayers(); markers.clear();
    records.forEach(record => {
      const marker = L.marker([record.lat, record.lng], { icon: L.divIcon({ className: `occurrence-pin ${record.group}`, iconSize: [12, 12], iconAnchor: [6, 6] }), title: record.name, alt: record.name, keyboard: true });
      marker.on('click', () => openRecord(record)); clusters.addLayer(marker); markers.set(record.id, marker);
    });
    if (fit && records.length) fitRecords();
    if (fit && !records.length) map.setView([12.3, 122.1], 5);
  }
  function fitRecords() {
    if (!map || !clusters.getLayers().length) return;
    map.fitBounds(clusters.getBounds(), { paddingTopLeft: [40, 90], paddingBottomRight: [40, 45], maxZoom: 10, animate: false });
  }
  function renderLoading() {
    $('record-list').replaceChildren();
    for (let i = 0; i < 4; i++) { const card = element('div', 'loading-card'); card.setAttribute('aria-hidden', 'true'); card.append(element('div'), element('span')); $('record-list').append(card); }
    $('results-summary').textContent = 'Loading records from GBIF…';
  }
  function renderEmpty(title, description) {
    const empty = element('div', 'empty-state'); empty.append(element('h3', '', title), element('p', '', description));
    if (state.view === 'saved') { const back = element('button', 'button button-outline', 'Explore records'); back.type = 'button'; back.addEventListener('click', () => toggleShortlist(false)); empty.append(back); }
    $('record-list').replaceChildren(empty);
  }
  function thumbnailURL(photo, size = 'medium') {
    const url = safeURL(photo?.url); if (!url) return '';
    // iNaturalist exposes a documented size variant; other publishers retain
    // their original URLs rather than guessing a thumbnail API for them.
    return /inaturalist-open-data\.s3\.amazonaws\.com\/photos\/\d+\/original\./.test(url) ? url.replace('/original.', `/${size}.`) : url;
  }
  function renderResults(fit = false) {
    const records = visibleRecords(); $('record-list').replaceChildren();
    $('results-heading').textContent = state.view === 'saved' ? 'Your saved records' : 'Occurrence records';
    $('pagination').hidden = state.view === 'saved';
    if (state.view === 'saved') {
      $('results-summary').textContent = `${formatNumber(records.length)} records saved in this browser`;
      $('active-scope').textContent = 'Your personal field shortlist';
    } else {
      const start = records.length ? state.offset + 1 : 0, end = state.offset + records.length;
      $('results-summary').textContent = `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(state.count)} matching records`;
      const f = state.applied;
      if (f) $('active-scope').textContent = [f.area === 'map' ? 'Current map area' : AREAS[f.area].label, f.taxon?.name || (f.group !== 'all' ? GROUPS[f.group].label : ''), f.from || f.to ? `${f.from || 1600}–${f.to || new Date().getFullYear()}` : '', f.photos ? 'with photos' : 'all media'].filter(Boolean).join(' · ');
      $('page-label').textContent = `Page ${Math.floor(state.offset / PAGE_SIZE) + 1}${state.count > SEARCH_LIMIT && state.offset + PAGE_SIZE >= SEARCH_LIMIT ? ' · narrow search for more' : ''}`;
    }
    if (!records.length) renderEmpty(state.view === 'saved' ? 'Your next discovery starts here.' : 'No records for this search.', state.view === 'saved' ? 'Use the bookmark beside a record to keep it in your field shortlist.' : 'Try a broader location or year range, or turn off “With photos”. No records does not mean a species is absent.');
    const fragment = document.createDocumentFragment();
    records.forEach(record => {
      const card = element('article', `record-card${state.selected === record.id ? ' selected' : ''}`); card.dataset.recordId = record.id;
      const photo = element('div', 'record-photo'); photo.append(element('span', '', 'No photo'));
      if (record.photo) { const img = element('img'); img.src = thumbnailURL(record.photo); img.alt = record.name; img.loading = 'lazy'; img.width = 78; img.height = 86; img.addEventListener('error', () => img.remove(), { once: true }); photo.append(img); }
      const info = element('div', 'record-info');
      info.append(element('p', 'record-category', GROUPS[record.group]?.label || 'Biodiversity'));
      const open = element('button', 'record-open'); open.type = 'button'; open.append(element('h3', '', record.name)); open.setAttribute('aria-label', `View ${record.name}, ${record.place}, ${readableDate(record)}`); open.addEventListener('click', () => openRecord(record));
      const meta = element('div', 'record-meta'); meta.append(element('span', '', readableDate(record)), element('span', 'record-type', humanType(record.type)));
      info.append(open, element('p', 'record-place', record.place), meta);
      const save = element('button', 'save-record'); save.type = 'button'; save.innerHTML = bookmarkSVG; save.dataset.saveId = record.id; updateSaveButton(save, record); save.addEventListener('click', () => saveRecord(record));
      card.append(photo, info, save); fragment.append(card);
    });
    $('record-list').append(fragment); $('record-list').scrollTop = 0;
    renderMap(fit);
  }
  function openRecord(record) {
    state.selected = record.id;
    document.querySelectorAll('.record-card').forEach(card => card.classList.toggle('selected', card.dataset.recordId === record.id));
    const target = $('record-detail'); target.replaceChildren();
    if (record.photo) {
      const img = element('img', 'detail-photo'); img.src = thumbnailURL(record.photo, 'large'); img.alt = record.name;
      img.addEventListener('error', () => img.replaceWith(element('div', 'detail-no-photo', 'The source photograph is unavailable.')), { once: true }); target.append(img);
    } else target.append(element('div', 'detail-no-photo', 'No photograph supplied with this record.'));
    const content = element('div', 'detail-content');
    const title = element('h2', '', record.name); title.id = 'detail-title';
    content.append(element('p', 'eyebrow', `${GROUPS[record.group]?.label || 'Biodiversity'} / GBIF ${record.id}`), title, element('p', 'detail-place', record.commonName ? `${record.commonName} · ${record.place}` : record.place));
    const save = element('button', 'button button-outline detail-save'); save.type = 'button'; save.dataset.saveId = record.id; updateSaveButton(save, record); save.addEventListener('click', () => saveRecord(record)); content.append(save);
    const grid = element('dl', 'detail-grid');
    function fact(label, value, wide = false) { const wrapper = element('div', wide ? 'span-two' : ''); wrapper.append(element('dt', '', label)); const dd = element('dd'); if (value instanceof Node) dd.append(value); else dd.textContent = value; wrapper.append(dd); grid.append(wrapper); }
    fact('Recorded date', readableDate(record)); fact('Evidence type', humanType(record.type));
    fact('Published coordinates', coordinatesValid(record.lat, record.lng) ? `${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}` : 'Not supplied');
    fact('Coordinate uncertainty', record.uncertainty !== null ? `${formatNumber(record.uncertainty)} metres (reported)` : 'Not supplied');
    if (record.locality) fact('Locality', record.locality, true);
    fact('Recorded by', record.recordedBy); fact('Record licence', record.license ? externalLink(licenseLabel(record.license), record.license) : 'Not supplied');
    fact('Source dataset', record.dataset, true); content.append(grid);
    const quality = [record.generalizations, record.withheld].filter(Boolean).join(' ');
    content.append(element('p', 'detail-caution', quality || 'Coordinates and dates are shown as published. A mapped record is historical evidence, not a current wildlife location.'));
    if (record.issues?.length) content.append(element('p', 'detail-caution', `Publisher / GBIF quality notes: ${record.issues.map(s => s.toLowerCase().replaceAll('_', ' ')).join('; ')}.`));
    if (record.photo) {
      const credit = element('p', 'photo-credit', `Photo: ${record.photo.creator || 'Creator not supplied'} · `);
      if (safeURL(record.photo.license)) credit.append(externalLink(licenseLabel(record.photo.license), record.photo.license)); else credit.append(document.createTextNode('Photo licence not supplied'));
      if (safeURL(record.photo.source)) { credit.append(document.createTextNode(' · ')); credit.append(externalLink('Original photograph', record.photo.source)); }
      content.append(credit);
    }
    content.append(externalLink('View the original GBIF record', `https://www.gbif.org/occurrence/${record.id}`, 'button button-primary'));
    target.append(content); $('record-dialog').showModal(); $('record-dialog').scrollTop = 0;
  }

  function closeSuggestions() {
    suggestionRequest++; suggestionController?.abort(); clearTimeout(suggestionTimer);
    suggestions = []; suggestionIndex = -1; $('species-options').hidden = true; $('species-options').replaceChildren();
    $('species-input').setAttribute('aria-expanded', 'false'); $('species-input').removeAttribute('aria-activedescendant');
  }
  function chooseSuggestion(index) {
    const suggestion = suggestions[index]; if (!suggestion) return;
    state.taxon = suggestion; $('species-input').value = suggestion.name; state.group = 'all'; updateGroupButtons();
    $('clear-species').hidden = false; closeSuggestions(); $('species-input').focus();
  }
  async function suggestSpecies(query) {
    const requestId = ++suggestionRequest; suggestionController?.abort();
    const controller = new AbortController(); suggestionController = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const data = await fetchJSON(`${API}/species/suggest?q=${encodeURIComponent(query)}&rank=SPECIES&limit=10`, controller.signal); //Retrieves species name suggestions while the user types.
      if (requestId !== suggestionRequest || $('species-input').value.trim() !== query || !Array.isArray(data)) return;
      const unique = new Map();
      data.forEach(item => { const name = cleanText(item.canonicalName, item.scientificName); if (name && item.key && item.rank === 'SPECIES' && !unique.has(name)) unique.set(name, { name, key: item.key, context: [item.family, item.kingdom].filter(Boolean).join(' · ') }); });
      suggestions = [...unique.values()].slice(0, 6); suggestionIndex = -1;
      $('species-options').replaceChildren();
      suggestions.forEach((item, index) => { const option = element('li', '', item.name); option.id = `species-option-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.append(element('small', '', item.context)); option.addEventListener('mousedown', event => event.preventDefault()); option.addEventListener('click', () => chooseSuggestion(index)); $('species-options').append(option); });
      $('species-options').hidden = suggestions.length === 0; $('species-input').setAttribute('aria-expanded', String(suggestions.length > 0));
      $('species-hint').textContent = suggestions.length ? `${suggestions.length} species suggestions. Use the arrow keys to choose.` : 'No suggestions. Try a full scientific name.';
    } catch (error) { if (error.name !== 'AbortError' && requestId === suggestionRequest) $('species-hint').textContent = 'Suggestions unavailable. You can still enter a full scientific name.'; }
    finally { clearTimeout(timeout); }
  }
  function updateGroupButtons() { document.querySelectorAll('[data-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.group === state.group))); }
  function toggleShortlist(show) {
    state.view = show ? 'saved' : 'results'; $('shortlist-toggle').setAttribute('aria-pressed', String(show));
    $('filters').hidden = show; $('saved-banner').hidden = !show; $('request-message').hidden = true; $('search-map').disabled = show || !map;
    renderResults(true); setBusy(state.loading);
  }
  function clearSpecies() { state.taxon = null; $('species-input').value = ''; $('clear-species').hidden = true; closeSuggestions(); }
  $('search-form').addEventListener('submit', event => { event.preventDefault(); closeSuggestions(); runSearch(); });
  $('clear-species').addEventListener('click', () => { clearSpecies(); $('species-input').focus(); });
  $('species-input').addEventListener('input', () => {
    closeSuggestions(); state.taxon = null; const query = $('species-input').value.trim(); $('clear-species').hidden = !query;
    if (query.length >= 2) suggestionTimer = setTimeout(() => suggestSpecies(query), 350);
  });
  $('species-input').addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSuggestions(); return; }
    if (!suggestions.length) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      [...$('species-options').children].forEach((option, index) => option.setAttribute('aria-selected', String(index === suggestionIndex)));
      $('species-input').setAttribute('aria-activedescendant', `species-option-${suggestionIndex}`);
    } else if (event.key === 'Enter' && suggestionIndex >= 0) { event.preventDefault(); chooseSuggestion(suggestionIndex); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.species-field')) closeSuggestions(); });
  $('species-input').addEventListener('blur', () => setTimeout(closeSuggestions, 180));
  document.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => { state.group = button.dataset.group; clearSpecies(); updateGroupButtons(); runSearch(); }));
  $('photos-only').addEventListener('change', () => runSearch());
  $('reset-filters').addEventListener('click', () => { $('search-form').reset(); clearSpecies(); state.group = 'all'; state.mapBounds = null; updateGroupButtons(); runSearch(); });
  $('previous-page').addEventListener('click', () => runSearch({ offset: Math.max(0, state.offset - PAGE_SIZE), filters: state.applied }));
  $('next-page').addEventListener('click', () => runSearch({ offset: state.offset + PAGE_SIZE, filters: state.applied }));
  $('retry-search').addEventListener('click', () => runSearch());
  $('shortlist-toggle').addEventListener('click', () => toggleShortlist(state.view !== 'saved'));
  $('back-to-results').addEventListener('click', () => toggleShortlist(false));
  $('fit-map').addEventListener('click', fitRecords);
  $('search-map').addEventListener('click', () => {
    if (!map) return;
    const bounds = map.getBounds();
    const west = Math.max(116, bounds.getWest()), east = Math.min(127.5, bounds.getEast()), south = Math.max(4, bounds.getSouth()), north = Math.min(22, bounds.getNorth());
    if (west >= east || south >= north) { announce('Move the map over the Philippines before searching this area.'); return; }
    state.mapBounds = [west, south, east, north].map(n => Number(n.toFixed(5))); $('area-select').value = 'map'; runSearch();
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    document.body.dataset.mobileView = button.dataset.view;
    document.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    if (button.dataset.view === 'map') requestAnimationFrame(() => { map?.invalidateSize(); fitRecords(); });
  }));
  $('about-data').addEventListener('click', () => $('data-dialog').showModal());
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); });
  });
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { readSaved(); renderResults(false); } });
  for (const id of ['year-from', 'year-to']) $(id).max = new Date().getFullYear();
  readSaved(); setupMap(); runSearch();
})();
