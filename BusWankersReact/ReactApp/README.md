# Bus Wankers React Application

This is a React-based web application that replaces the static `www/wankers.html` and
`www/test_page.html` pages. It documents how to use the Bus Wankers Glastonbury
autofill functionality, and is updated for the **2027 Glastonbury General Sale**
(sale opens 9:00am BST, Sunday 4th October 2026).

## Features

- Responsive design that works on desktop and mobile devices
- Displays instructions for using the autofill feature, with the current sale's key dates
- Shows images and video demonstrations
- Includes a download link for the `g_autofill.csv` autofill file
- A working test page (`/test`) with real `registrations_N__RegistrationId` /
  `registrations_N__PostCode` fields (up to 6 people per group, matching
  `Common/BusWankers.cs`'s `DEFAULT_MAX_IN_A_GROUP`) so the AutoFill Options browser
  extension can be tested end-to-end before the real sale

## Getting Started

1. Install dependencies:
   ```
   npm install
   ```

2. Start the development server:
   ```
   npm start
   ```

3. Build for production:
   ```
   npm run build
   ```

## Files Structure

- `src/App.jsx` - Main App component, sets up routing (`/` and `/test`) with `HashRouter`
  (chosen so the built site can be served as static files without server-side rewrite rules)
- `src/components/Navigation.jsx` - Top navigation between the documentation and test pages
- `src/components/BusWankersPage.jsx` - Main component displaying the documentation
- `src/components/BusWankersPage.css` - Styling for the documentation page
- `src/components/TestPage.jsx` - Functional mockup of the Glastonbury registration form
- `src/components/TestPage.css` - Styling for the test page
- `src/index.js` - Entry point for the React application
- `public/g_autofill.csv` - The autofill file served for download from the documentation
  page (regenerate this each year from `CSVFromSpreadsheet`/`AutofillFromCSV` with the
  current group's registration numbers and postcodes before the sale)

## Deployment

Deployed the same way as the RozeBowl React frontends: built and pushed to
**holly** (192.168.0.252, nginx static front door), served behind
`https://longmanrd.net/buswankers/`.

One-time setup on holly (creates the `/srv/BusWankersSharp` web root and the
`/buswankers/` nginx location):

```
sudo ./ops/deploy/setup-holly-buswankers-links.sh   # run ON holly
```

then add the include from `ops/nginx/buswankers.inc` to holly's
`/etc/nginx/sites-available/longmanrd.net` server block (alongside the other
`*.inc` includes) and `nginx -t && systemctl reload nginx`.

Every deploy after that:

```
./deploy-buswankers-frontend.sh
```

This mirrors `deploy-breaktackle-frontend.sh` (build here, rsync the build to
a staging dir on holly, remote `sudo` sync into place with `www-data`
ownership, reload nginx) but trimmed down - no shared `@if/web-common`
libraries to rebuild, no backend API, no per-environment `config.js`. One
difference worth remembering: this is **Create React App**, not Vite, so the
build output is `build/`, not `dist/`.

`package.json`'s `"homepage": "/buswankers"` is what makes CRA emit correctly
-prefixed asset URLs (and is what `process.env.PUBLIC_URL` resolves from in
the components) - keep it in sync if the public path ever changes. The app
uses `HashRouter`, so `/buswankers/#/test` is the only client-side route
nginx never needs to know about; the `try_files ... /buswankers/index.html`
fallback in the `.inc` only matters for a direct hit that isn't a static
asset.

## Assets still needed

The following binary assets are referenced by `BusWankersPage.jsx` but were not part of
the source zip (they're presumably kept outside git) - copy them into `public/` before
deploying:

- `Hippies_1.png`
- `sync.png`
- `formfield.png`
- `DannyVid.mp4`

## Usage

This application replaces the static HTML documentation page (`wankers.html`) with a
more modern, React-based interface that provides the same information in a more
interactive and responsive way, plus a working test page instead of a second static file.
