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

One page, four tabs (`src/tabs.js`). The active tab is the URL hash
(`#documentation`, `#test-form`, ...) so tabs are bookmarkable and plain in-page
links switch between them; every tab body stays mounted, so switching tabs never
loses an upload result or a half-filled test form. **Documentation is the landing
tab.** The nav bar also carries a **WhatsApp** shortcut to the group when
`WHATSAPP_GROUP_URL` in `src/links.js` is set (it's hidden while that's empty).

1. **Update Files** (`IngestBar`) - choose a registration workbook, enter the shared
   password, click *Upload & Ingest*. Every sale sheet in the workbook is generated
   and written into the live autofill files in one go (a sale sheet that has been
   **emptied** removes its file - the spreadsheet is the source of truth); the
   roster sheet is read into the running order; per-sheet outcomes are shown and
   the other tabs refresh.
2. **Documentation** (`DocumentationSection`) - the landing tab. Pick a sale
   (Coach Tickets, General Sale, Resale - Coach, Resale - General, Demo), see its
   key dates/cost, then choose a fill method from two equal cards (remembered per
   browser in localStorage, default Bookmark):
   - **Bookmark** - the primary route is a single draggable **\<Sale\> Filler**
     bookmarklet (`SaleBookmarklet`, e.g. "Coach Filler", "General Filler") that covers every
     group: drag it once, and on click it shows a tap-to-choose picker for
     the person's own group before filling (see "One bookmark for the WHOLE
     sale" below). Behind an "advanced options" `<details>`, the older routes
     are still there for anyone who wants them: a *Download "Glasto \<Sale\>
     Bookmarks"* button producing a standard bookmarks HTML file
     (`bookmarkFolderHtml`) that imports as one folder holding a bookmark per
     group, with per-browser import steps; and, below that, each group's own
     draggable **Glasto nnnn - Fill \<Sale\> Group X** bookmarklet (sale-qualified -
     see "Groups are named per sale" below), a *Try it on the
     Test Form* button, and (collapsed) a copy/paste table of the group's reg
     numbers and postcodes (`GroupFillPanel`).
   - **AutoFill Options extension** (`ExtensionInstructions`) - the original
     route: Download button, Remote Import URL, screenshots, video, with the free
     plan's 10-fills-a-day cap warned up front.

   A sale with nothing ingested reads `(empty)` and explains.

   **Why bookmarklets (2026-09-16):** Lightning Autofill's free plan is capped at
   10 profile executions per day - anyone who tests or reloads on sale morning can
   be locked out during the sale. A bookmarklet (`src/bookmarklet.js`) is a
   bookmark whose address is JavaScript: clicked on the See Tickets registration
   page it fills `registrations_N__RegistrationId` / `registrations_N__PostCode`
   (matched by id/name, case-insensitively, with a class/positional fallback),
   writing values through the native setter + input/change events so plain,
   jQuery-validated and React forms all accept them. Bookmarklets are generated
   client-side from the SAME autofill CSV the extension uses (parsed by
   `parseAutofillCsv`), so the extension route stays in step with no backend
   change needed just to keep them consistent. Verified against a saved copy of
   the real 2023 `gfl/addregistrations` page.

   **Hybrid live-fetch, with an embedded fallback (2026-09-17):** a bookmarklet's
   data used to be baked in once, at generation time, and then sat unchanged in
   the user's real browser bookmarks for as long as they kept it - correct only
   until the underlying spreadsheet was next re-ingested. Now every bookmarklet
   ALSO carries the URL of its sale's live, structured group data
   (`GET /files/{filename}/groups`, served by `UploadServiceController.
   DownloadGroups` from a JSON sidecar `UploadServiceController.Ingest` writes
   alongside the CSV - see `AutofillStore.SaveGroupsAsync`), and tries that
   first on click: a single fetch, aborted after 4 seconds, cross-origin, from
   whatever page happens to be open (the actual registration page, on a domain
   this app has no way to know in advance - the service's CORS policy already
   allows any origin regardless, see the comment in `UploaderService/
   Program.cs`). Only if that fails - offline, timeout, the registration page's
   own CSP blocking the request, nothing re-ingested since the bookmark was made
   - does it fall back to the data embedded at generation time, exactly as
   bookmarklets always worked before this. The confirmation banner the
   bookmarklet shows on click says plainly which one was used ("live data" vs
   "offline backup data"), so nobody has to guess. This is why there's no
   staleness-detection UI on this page any more (an earlier version of this
   feature stamped every bookmark/folder/filename with the data's timestamp and
   warned when they drifted apart): the live fetch means a bookmark generated
   weeks ago still gets today's data on the day, in the common case, so the
   folder/filename/bookmark title are back to a single stable form with no
   version suffix (`bookmarkFolderName`, `bookmarkletTitle`).

   The JSON sidecar is written from the SAME already-parsed `RegistrationGroup`
   data `Common/BusWankers.cs`'s `GenerateAutofillTextFromGroups` turns into CSV
   text - not re-derived by parsing that CSV back - so there is exactly one place
   (`UploadServiceController.Ingest`) that turns a spreadsheet into groups, and
   the bookmarklet's own (deliberately old-school) JavaScript never has to parse
   CSV at all.

   **One bookmark for the whole sale (2026-09-17):** a browser page cannot write
   to the bookmarks bar itself - that's deliberately not exposed to web content
   by any browser, which is exactly why the folder-download-then-import route
   above needs a native "Import bookmarks from HTML" dialog to do it at all. The
   one thing a page CAN do in a single user gesture is let someone drag ONE link
   onto the bar, so `SaleBookmarklet`/`saleBookmarkletSource` builds a single
   bookmarklet (`SALE_FILL_SOURCE`) covering every group in a sale: on click it
   live-fetches (or falls back to the data embedded at generation time, on the
   same terms as the per-group `FILL_SOURCE`) every group, then shows a plain
   tap-to-choose overlay so the person picks their own group before it fills the
   page. The older per-group bookmarklets and the whole-folder download are
   demoted to an "advanced options" `<details>` for anyone who'd rather have a
   bookmark already set to a specific group, or is installing on someone
   else's browser.

   **Three routes, with pros/cons, extension left/default (2026-09-18):** the
   method-chooser cards on the Documentation tab now read left to right as
   AutoFill Options extension (the route used in previous buying rounds, so
   it's the default `chooseMethod`/`readSavedMethod` falls back to and the
   leftmost card), Bookmark, and a plain-text Copy & paste card that links
   straight to the standalone Groups tab (`#groups`, see `GroupsSection`) as
   the last-resort fallback. Each of the first two cards carries a short
   Pros/Cons list (`ProsCons` in `DocumentationSection.jsx`) - rendered as
   plain `<span>`/`<br>` rather than `<ul>`/`<dl>` because the cards are
   `<button>`s, whose content model is phrasing content only.

   **Groups are named per sale, not just by letter (2026-09-18):** a "Group A"
   is only unique within its own sale - the Coach sale's Group A and the
   General sale's Group A are different people entirely - so every place a
   group is named to a person now reads "Coach Group A" / "General Group A" /
   "Coach Resale Group A" / "General Resale Group A" rather than a bare
   "Group A". `group.label` itself is still just the raw letter (it has to
   stay that way to match the live groups JSON's own label field - see
   `liveMembersFor` in `FILL_SOURCE`), so the sale prefix is layered on at
   display/generation time by `groupDisplayLabel(saleFolderLabel, label)`
   (`src/bookmarklet.js`) - used by `bookmarkletTitle`, the `GroupFillPanel`/
   `GroupsSection` card headings, and (built into `S`, a fourth variable now
   in scope alongside `M`/`G`/`U`) `FILL_SOURCE` and `SALE_FILL_SOURCE`'s own
   on-page confirmation banners and the whole-sale bookmarklet's tap-to-choose
   picker. `saleFolderLabel` is always `SALE_INFO[...].folderLabel` from
   `src/saleInfo.js` ("Coach", "General", "Coach Resale", "General Resale").

   This reaches past the frontend too: the backend now bakes the same prefix
   into the generated autofill CSV's profile names (`BusWankers.
   GenerateAutofillTextFromGroups`, given the sale's label via
   `UploadServiceController.SaleFolderLabelFor` - kept in step with
   `saleFolderLabel` above by hand, since one's C# and the other's JS) and the
   live groups JSON's `Name` field (`ToGroupsDocument`) - so "Coach Group-A"
   and "General Group-A" show up as two clearly different, non-colliding
   profiles once imported into AutoFill Options/Lightning Autofill, which has
   no idea of "sale" itself and previously saw two identically-named
   "Group-A" profiles the moment someone imported both sales' files.
   `groupLabelFromProfileName` (the frontend's own CSV parser) had its regex
   loosened from `^Group-(.+)$` to `Group-(.+)$` so it still recovers the bare
   letter from a sale-prefixed name.

   **Whole-sale bookmarklet always confirms the group (2026-09-18):** the
   tap-to-choose picker in `SALE_FILL_SOURCE`/`withGroups` used to skip
   straight to `fillWithData` when a sale only had one group, so a
   single-group sale filled the page with no confirmation while a
   multi-group sale always showed the picker first. `withGroups` now always
   calls `showPicker`, even for a single group, so the behaviour - and the
   chance to bail out via Cancel - is identical no matter how many groups
   the sale has.

   **Short "<Sale> Filler" bookmark name, plus a proper app icon (2026-09-18):**
   the one bookmark people actually drag (`saleBookmarkletTitle`) used to be
   titled `Glasto 2027 - Fill My Group (Coach)`; it's now just `Coach Filler` /
   `General Filler` / `Coach Resale Filler` / `General Resale Filler` - short
   enough to read at a glance in a crowded bookmarks bar, and still
   sale-specific via `saleFolderLabel` so it can never be confused with the
   other sale's bookmark. The app also now ships a real favicon
   (`public/favicon.svg`, a bus-and-ticket mark referenced from
   `public/index.html`/`public/manifest.json`) where before there was none -
   `favicon.ico`/`logo192.png`/`logo512.png` were referenced by the
   Create-React-App template but never actually existed. Browsers generally
   show the favicon of the page you dragged a link FROM for that bookmark
   (not the bookmarklet's own, since a `javascript:` URL has no site of its
   own to fetch one from), so this icon should now show up next to the
   bookmark for anyone who (re-)creates it from this app's own pages -
   exactly how bookmarks are always installed here.

3. **Running Order** (`RunningOrderSection`) - the *Glasto nnnn Running Order*:
   everyone on the workbook's `Glasto nnnn` roster tab (reg number + name, surname
   order) as of the last ingest. `nnnn` is the festival year, read from that tab's
   name, and is what every other "2027"-style mention on the page uses
   (`src/festival.js` holds the fallback for a store with no roster yet). Since
   2026-09-18 the table also carries one column per sale (`Coach`, `General`,
   `Coach Resale`, `General Resale`, `Demo` - the same order `Object.entries
   (SALE_INFO)` uses everywhere else) showing which group, if any, that person
   is in for that sale, or a dash once its file has been ingested with nobody
   in it under that reg number. This needed all FIVE sales' groups loaded at
   once - not just whichever one is currently selected on Documentation/Groups
   - so `RunningOrderSection` now takes the same `storedFiles`/`storeStatus`/
   `storeError` props those two already get from `BusWankersPage`, and calls
   `useAutofillGroups` once per `SALE_INFO` entry (a fixed, known set of keys,
   so a fixed number of hook calls, same rules as any other hook). Each sale's
   registration-number -> group-letter lookup is built by the new
   `buildGroupLookup`/`groupLabelForRegistration` in `src/runningOrder.js`
   (alongside the existing `buildNameLookup`/`nameForRegistration`), from the
   exact same parsed-CSV shape those already work with, so there's no second,
   diverging way of reading an autofill file's groups. The cell shows the RAW
   group letter (not sale-qualified) since the column header already says
   which sale.

4. **Test Form** (`TestSection`) - a mockup of the Glastonbury registration form with
   real `registrations_N__RegistrationId` / `registrations_N__PostCode` fields (up to
   6 people per group, matching `Common/BusWankers.cs`'s `DEFAULT_MAX_IN_A_GROUP`) so
   the extension's profile can be tested end-to-end before the real sale.

The old "generate a one-off file" form was removed from the page on 2026-09-16; the
backend's `POST /sheets` / `POST /generate` routes it used are still there.

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
| `GET  /running-order`        | none     | running order list + festival year (404 until ingested) |
| `POST /sheets`, `POST /generate` | password | (no longer used by the page - kept for scripting) |

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

- `src/App.jsx` - App shell: `Navigation` + `BusWankersPage`. No router - the tab is
  the URL hash
- `src/tabs.js` - The tab list and the `useActiveTab` hook (hash-driven)
- `src/links.js` - `WHATSAPP_GROUP_URL` for the nav bar's WhatsApp shortcut
- `src/components/Navigation.jsx` / `.css` - The tab bar (+ WhatsApp button)
- `src/components/BusWankersPage.jsx` - Renders the four tab bodies (hiding all but
  the active one) and owns the shared state: the map of files currently in the
  backend store (fetched from `GET /files`, refreshed after an ingest) and the
  running order / festival year (`GET /running-order`)
- `src/festival.js` - `DEFAULT_YEAR`, the fallback festival year when no roster
  has been ingested
- `src/components/IngestBar.jsx` / `.css` - The upload bar (`POST /ingest`)
- `src/components/RunningOrderSection.jsx` / `.css` - The collapsible
  *Glasto nnnn Running Order* list (`GET /running-order`)
- `src/bookmarklet.js` - `parseAutofillCsv` (AutoFill CSV -> groups),
  `FILL_SOURCE` / `bookmarkletHref` / `bookmarkletSource` / `bookmarkletTitle`
  / `runFillOnThisPage` (the per-group bookmarklet: live fetch of the sale's
  groups URL with a timed fallback to the embedded data, see the file's own
  header comment), and `SALE_FILL_SOURCE` / `saleBookmarkletHref` /
  `saleBookmarkletSource` / `saleBookmarkletTitle` / `runSaleFillOnThisPage`
  (the single whole-sale bookmarklet - same live-fetch/fallback rules, plus
  the tap-to-choose group picker)
- `src/components/SaleBookmarklet.jsx` / `.css` - The single, primary
  whole-sale bookmarklet on the Documentation tab: one draggable link, a
  Try-it button
- `src/components/GroupFillPanel.jsx` / `.css` - The per-group cards, now
  under the Documentation tab's "advanced options": draggable bookmarklet,
  Try-it button, copy/paste table
- `src/components/DocumentationSection.jsx` / `.css` - Documentation: sale
  dropdown, key dates, the three-way method chooser (extension/bookmark/copy
  & paste, each with a short Pros/Cons list - extension is the default and
  leftmost), the bookmarklet steps, the collapsed extension instructions, and
  the copy & paste method's link to the Groups tab. `SALE_INFO` at the top of
  the file is the single place that defines each sale's label, heading,
  dates, cost and filename - a new sale sheet needs an entry here to appear
  in the dropdown (the backend handles any sheet name without a code change)
- `src/components/TestSection.jsx` / `.css` - Mockup of the registration form
- `src/api/autofillApi.js` - Shared client for the autofill API (base path, error
  reading, `fetchStoredFiles`, `fetchRunningOrder`, `fetchAutofillGroups`,
  `groupsUrlFor` (the absolute URL baked into bookmarklets for their live
  fetch), `ingestWorkbook`, `downloadStoredFile`, `saveBlob`)
- `src/index.js` - Entry point
- `public/` - Static assets referenced by the page: the screenshots (`Hippies_1.png`,
  `sync.png`, `formfield.png`, ...) and `DannyVid.mp4`. No autofill files belong here
- `public/test_page.html` - a saved copy of the REAL `glastonbury.seetickets.com`
  `gfl/addregistrations` page (captured 2023), served as-is at
  `https://longmanrd.net/buswankers/test_page.html` so bookmarks and the extension
  can be rehearsed against genuine markup. Sanitised: Google Tag Manager, Google
  Translate, the reservation timer and the cookie banner removed; the pre-filled
  values cleared; See Tickets' own inline scripts wrapped in try/catch (their CSS/JS
  still load from `c.ststat.net`); the form posts nowhere - a capture-phase submit
  handler shows what the boxes hold instead. Linked from the Test Form tab and both
  sets of instructions.

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
