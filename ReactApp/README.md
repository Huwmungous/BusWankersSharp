# Bus Wankers React Application

The Bus Wankers site: one React page that documents how to use the Glastonbury
autofill files with the AutoFill Options browser extension, lets a group organiser
refresh those files from a registration spreadsheet, and provides a mockup of the
registration form to test against. Updated for the **2027 Glastonbury sales**
(coach + ticket package sale 6:00pm BST Thursday 1st October 2026; general sale
9:00am BST Sunday 4th October 2026).

It replaced the original static `www/wankers.html` / `www/test_page.html` pages,
which have since been removed from the repo.

## What's on the page

Top to bottom (all one page - the nav bar links are in-page anchors):

1. **Upload bar** (`IngestBar`) - choose a registration workbook, enter the shared
   password, click *Upload & Ingest*. Every sale sheet in the workbook is generated
   and written into the live autofill files in one go; per-sheet outcomes are shown
   and the dropdown below refreshes.
2. **Documentation** (`DocumentationSection`) - a dropdown of the autofill files
   (Coach Tickets, General Sale, Resale - Coach, Resale - General, Demo), each with
   its own key dates, cost info where known, and the Remote Import URL to paste into
   AutoFill Options. A sale with nothing ingested yet reads `(empty)`; the
   **Download** button next to the dropdown (and the "this link" download in the
   text) is disabled for it.
3. **Test form** (`TestSection`) - a mockup of the Glastonbury registration form with
   real `registrations_N__RegistrationId` / `registrations_N__PostCode` fields (up to
   6 people per group, matching `Common/BusWankers.cs`'s `DEFAULT_MAX_IN_A_GROUP`) so
   the extension's profile can be tested end-to-end before the real sale.
4. **Generate a one-off file** (`UploadSection`) - upload a spreadsheet, pick one
   sale sheet, get that sale's autofill file straight back as a download. This does
   **not** touch the live files - it's for checking a spreadsheet or handing a file
   to someone directly. Use the upload bar at the top to publish.

## Where the autofill files live and how they're downloaded

The autofill files are **not** static assets in this app. They live in
UploaderService's `AutofillStore` on intelligence
(`/srv/BusWankersSharp/Data/autofill`, created by the backend installer, outside the
deploy path so releases don't wipe it) and are named by
`UploadServiceController.DownloadNameFor`:

| Sale sheet         | File                          |
|--------------------|-------------------------------|
| Coach              | `coach_autofill.csv`          |
| General            | `general_autofill.csv`        |
| Resale - Coach     | `coach_resale_autofill.csv`   |
| Resale - General   | `general_resale_autofill.csv` |
| Demo               | `demo_autofill.csv`           |
| anything else      | `<slug-of-sheet-name>_autofill.csv` |

The page talks to the backend at `/buswankers-api/api/autofill` (holly's nginx proxies
that to intelligence:5038 - `ops/nginx/buswankers-api.inc`):

| Endpoint                     | Auth     | Used by                                            |
|------------------------------|----------|----------------------------------------------------|
| `POST /ingest`               | password | upload bar - every sale sheet -> the store          |
| `GET  /files`                | none     | dropdown - which files exist, size, last modified  |
| `GET  /files/{filename}`     | none     | Download button, "this link", Remote Import        |
| `POST /sheets`, `POST /generate` | password | one-off generate section                       |

Two ways a user gets a file, both served by `GET /files/{filename}`:

- **Remote Import** in AutoFill Options: the documented URL is still
  `https://longmanrd.net/buswankers/<file>` (e.g. `.../buswankers/general_autofill.csv`).
  The pre-2026 names `bw_autofill.csv` / `g_autofill.csv` are gone - anyone with one
  of those URLs saved in AutoFill Options needs the new one from the page.
  `ops/nginx/buswankers-api.inc` has a regex location that rewrites exactly that shape
  onto the API route.
- **Download button / "this link"**: fetches `/buswankers-api/api/autofill/files/<file>`
  and saves it via the browser (`src/api/autofillApi.js`).

The store starts empty after a fresh install: every sale shows `(empty)` until a
workbook has been ingested. To seed it by hand, drop a file with one of the names
above into the store directory on intelligence (owned by `BusWankersServices`).

## Getting Started

1. Install dependencies:
   ```
   npm install
   ```

2. Start the development server:
   ```
   npm start
   ```
   The page's `fetch()` calls go to `/buswankers-api/...` on the same origin, so for
   the upload/download parts to work locally you need either a proxy to a running
   UploaderService or to be testing against the deployed site.

3. Build for production:
   ```
   npm run build
   ```

## Files Structure

- `src/App.jsx` - App shell: `Navigation` + `BusWankersPage`. No router - one page,
  in-page anchors
- `src/components/Navigation.jsx` - Top nav bar of anchor links to the page sections
- `src/components/BusWankersPage.jsx` - Lays out the four sections in order and owns
  the one bit of shared state: the map of files currently in the backend store
  (fetched from `GET /files`, refreshed after an ingest)
- `src/components/IngestBar.jsx` / `.css` - The upload bar (`POST /ingest`)
- `src/components/DocumentationSection.jsx` / `.css` - Documentation with the
  dropdown and Download button. `SALE_INFO` at the top of the file is the single
  place that defines each sale's label, heading, dates, cost and filename - a new
  sale sheet needs an entry here to appear in the dropdown (the backend handles any
  sheet name without a code change)
- `src/components/TestSection.jsx` / `.css` - Mockup of the registration form
- `src/components/UploadSection.jsx` / `.css` - One-off generate-and-download form
  (`POST /sheets` then `POST /generate`)
- `src/api/autofillApi.js` - Shared client for the autofill API (base path, error
  reading, `fetchStoredFiles`, `ingestWorkbook`, `downloadStoredFile`, `saveBlob`)
- `src/index.js` - Entry point
- `public/` - Static assets referenced by the page: the screenshots (`Hippies_1.png`,
  `sync.png`, `formfield.png`, ...) and `DannyVid.mp4`. No autofill files belong here

## Deployment

Two halves, both wired into RozeBowlDeployDaemon's trunk pipeline on queeg (steps
"deploy buswankers frontend" and "deploy buswankers backend"), so a signal on
`rozebowl_deploy` deploys both. By hand:

- **Backend** (UploaderService, runs on intelligence):
  `UploaderService/deploy-buswankers-backend.sh` - builds here, ships to
  intelligence, runs `buswankers-remote-install.sh` there (which also creates the
  autofill store directory).
- **Frontend** (this app, served by holly's nginx at
  `https://longmanrd.net/buswankers/`): `ReactApp/deploy-buswankers-frontend.sh` -
  builds here, rsyncs `build/` to holly, and installs/wires both nginx includes
  (`buswankers.inc`, `buswankers-api.inc`) on every run.

Deploy the backend first when both have changed - the page is only as useful as
the API behind it.

One-time setup on holly (creates the `/srv/BusWankersSharp` web root):

```
sudo ./ops/deploy/setup-holly-buswankers-links.sh   # run ON holly
```

The frontend deploy mirrors `deploy-breaktackle-frontend.sh` (build here, rsync the
build to a staging dir on holly, remote `sudo` sync into place with `www-data`
ownership, reload nginx) but trimmed down - no shared `@if/web-common` libraries to
rebuild, no per-environment `config.js` (the API path is fixed, same-origin). One
difference worth remembering: this is **Create React App**, not Vite, so the build
output is `build/`, not `dist/`.

`package.json`'s `"homepage": "/buswankers"` is what makes CRA emit correctly
-prefixed asset URLs (and is what `process.env.PUBLIC_URL` resolves from in the
components) - keep it in sync if the public path ever changes. The
`try_files ... /buswankers/index.html` fallback in `buswankers.inc` only matters
for a direct hit that isn't a static asset. NB holly's `longmanrd.conf` currently
declares `location /buswankers/` inline in the HTTPS server block, so the deploy
script installs `buswankers.inc` but doesn't include it (nginx refuses a duplicate
location); `buswankers-api.inc` - the API proxy plus the `*_autofill.csv` rewrite -
is always wired into that block, and the script fails the deploy unless
`/buswankers-api/Health` then answers 200 from outside.
