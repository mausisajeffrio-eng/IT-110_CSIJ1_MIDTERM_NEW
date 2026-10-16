# BioAtlas PH

**A field guide to our living islands.** BioAtlas PH is a browser-based explorer for published Philippine species occurrence records from [GBIF](https://www.gbif.org). You can search by scientific name, species group, region and year, check where each record came from, and save a personal shortlist in your browser.

> IT 110 Midterm Project, 2026–2027. Individual project by **Jeff Rio Mausisa**.

It's plain HTML, CSS and JavaScript, with no build step, no `npm install`, no account and no API key.

---

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Running the tests](#running-the-tests-optional)
- [Data limitations](#data-limitations)
- [Privacy and storage](#privacy-and-storage)
- [Credits and licences](#credits-and-licences)
- [Author](#author)

---

## Quick start

### Requirements

- A modern browser (Chrome, Firefox, Edge or Safari)
- An internet connection, for GBIF data, record photos and map tiles
- **One** of these, to serve the files over HTTP:
  - Python 3 (already on macOS and most Linux; [download for Windows](https://www.python.org/downloads/))
  - Node.js
  - VS Code with the **Live Server** extension

> Serve the site over HTTP. Double-clicking `index.html` opens it as `file://`, and some features won't work that way.

### 1. Get the code

```bash
git clone https://github.com/mausisajeffrio-eng/IT-110_CSIJ1_MIDTERM_NEW.git
cd bioatlas-ph
```

You can also use **Code → Download ZIP** on GitHub, extract it, and open a terminal in the extracted folder.

### 2. Start a local server

Pick one option:

**Python (recommended)**

```bash
python3 -m http.server 8767 --bind 127.0.0.1
```

On Windows, use `py -m http.server 8767 --bind 127.0.0.1` if `python3` isn't found.

**Node.js**

```bash
npx serve -l 8767
```

**VS Code**: open the folder, right-click `index.html`, and choose **Open with Live Server**.

### 3. Open it

Go to **http://127.0.0.1:8767/** and click **Start exploring** to open the atlas (`app.html`).

Press `Ctrl + C` in the terminal to stop the server.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `Address already in use` | Port 8767 is taken. Use another port, such as `8080`, and open that port in the URL. |
| `python3: command not found` | Try `python` or `py` (Windows), or use the Node.js / Live Server option. |
| Map or records don't load | Check your internet connection. GBIF and OpenStreetMap must be reachable. The app shows a **Retry** button on network errors. |
| Blank page or missing styles | Make sure you opened the `http://` address and not the file directly. |

---

## Features

**Search and filter**
- Philippine-only occurrence search
- Scientific-name suggestions with exact-name validation
- Broad groups: all life, birds, plants, mammals and insects
- Area filters for Luzon, Visayas, Mindanao and Palawan
- Optional year range and "has photo" filter
- **Search this map area** and **Fit records** map controls

**Explore records**
- Clustered map markers with 60-record pagination
- Record details with the original GBIF source link, licence, image credits and quality notes
- Saved shortlist that persists in the browser (up to 200 records)

**Usability**
- Split map/list on desktop; map/list switch on mobile
- Keyboard controls, native accessible dialogs, reduced-motion support
- Clear loading, empty, invalid-input, network-error and retry states
- Stale requests are cancelled, and requests time out after 25 seconds

---

## How it works

The app calls the public **GBIF API** (`https://api.gbif.org/v1`) from the browser using `fetch` with `async/await`. It checks the HTTP status, parses the JSON and updates the page.

| Endpoint | Purpose |
| --- | --- |
| `GET /species/suggest?q=…&rank=SPECIES&limit=10` | Name suggestions while typing |
| `GET /species/match?name=…&strict=true` | Validate a typed scientific name |
| `GET /occurrence/search?country=PH&hasCoordinate=true&hasGeospatialIssue=false…` | Fetch mapped occurrence records |

- Every occurrence search keeps `country=PH`.
- Region filters are approximate bounding boxes, sent as a `geometry` polygon in longitude/latitude order.
- A selected suggestion supplies a `taxonKey`. Free-text names are validated before the app queries occurrences.

API docs: [GBIF OpenAPI](https://techdocs.gbif.org/en/openapi/) · [Occurrence](https://techdocs.gbif.org/en/openapi/v1/occurrence) · [Species](https://techdocs.gbif.org/en/openapi/v1/species)

---

## Project structure

```
bioatlas-ph/
├── index.html          Portfolio homepage and project introduction
├── app.html            Single-page biodiversity explorer
├── styles.css          Design tokens, layout and responsive styles
├── script.js           API requests, validation, map, DOM and shortlist
├── assets/
│   ├── philippine-trogon.jpg   Homepage hero photo
│   ├── favicon.svg
│   └── vendor/                 Leaflet + Leaflet.markercluster (with licences)
├── tests/              Optional development checks
├── DESIGN.txt          Design rationale and scope
├── LEARNING_GUIDE.txt  Step-by-step code walkthrough and presentation practice
├── ASSET_CREDITS.txt   Photo, API and library attribution
└── VERIFICATION.txt    Record of local test results
```

---

## Running the tests (optional)

You don't need the tests to run the site.

**Data tests** (Node.js 18+, no dependencies):

```bash
node --test tests/data.test.cjs
```

**Browser tests** need [Playwright](https://playwright.dev) with Chromium, and the local server running on port 8767. They make live GBIF requests.

```bash
npm install --no-save playwright
npx playwright install chromium
node tests/browser-smoke.cjs
node tests/browser-edge.cjs
```

Set `BIOATLAS_URL` to test a different port, for example `BIOATLAS_URL=http://127.0.0.1:8080`. Screenshots are saved to `/tmp/bioatlas-qa`.

---

## Data limitations

- Records are **evidence**, not population counts or live wildlife locations. Counts describe matching records.
- The map shows only the current page of results, or the saved shortlist.
- GBIF search can't page past 100,000 results. Narrow the filters to browse further.
- Photos, dates and locations can be missing or inaccurate. Coordinates may be generalized even when GBIF hasn't flagged them.
- Regions are approximate boxes, not official administrative borders.
- Search works best with **scientific names**. Common-name lookup isn't supported.
- The app never shows cached sample data as a live result.

## Privacy and storage

- Only the public metadata of records you save is stored, in your browser's `localStorage`.
- There's no login, telemetry, database or cloud sync.
- Search queries go to GBIF, images load from their publishers, and map tiles come from OpenStreetMap.
- Clearing browser storage removes the shortlist. A saved record is a snapshot, so follow its source link for the latest version.

## Credits and licences

- **Data:** [Global Biodiversity Information Facility (GBIF)](https://www.gbif.org). Each record and photo keeps its own licence, shown in the app.
- **Maps:** [Leaflet 1.9.4](https://leafletjs.com) and [Leaflet.markercluster 1.5.3](https://github.com/Leaflet/Leaflet.markercluster), vendored with their licence files in `assets/vendor/`. Tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- **Homepage photo:** Philippine trogon (*Harpactes ardens*) by dmalerta via [iNaturalist](https://www.inaturalist.org/photos/608488019), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

See [`ASSET_CREDITS.txt`](ASSET_CREDITS.txt) for all source links.

## Author

**Jeff Rio Mausisa**: HTML structure and semantics, CSS styling and responsive layout, JavaScript logic and API integration, and project management and documentation.
