// Thin client for the UploaderService autofill API, shared by the upload bar
// at the top of the page, the documentation section's dropdown/download
// button, and the generate-and-download form at the bottom.
//
// Sibling path to the frontend's own base (PUBLIC_URL=/buswankers) - proxied by
// holly's nginx to the UploaderService backend running on intelligence. See
// ops/nginx/buswankers-api.inc. Fixed from the domain root rather than built off
// PUBLIC_URL, since this API isn't served under /buswankers/ itself.
import { LoggerService } from '@if/web-common';
import { parseAutofillCsv } from '../bookmarklet';

export const API_BASE = '/buswankers-api/api/autofill';

// Authentication (2026-09-29): the page signs in through Keycloak before it
// renders (see src/main.jsx), and the fetch interceptor AppInitializer installs
// attaches the access token to every fetch() below - nothing here handles a
// token itself. The write route (POST /ingest) needs it; the GET routes are
// anonymous on the server so the extension and bookmarklets keep working, and
// simply carry a harmless token when the page calls them.

// Created on demand rather than at module load: LoggerService configures itself
// from the config service the first time it's used, and that is only ready once
// AppInitializer has finished. Every call is made from a component or handler
// that runs after that, so this is always safe - a module-level logger would
// not be. Attributes go in as context fields (searchable in the log viewer)
// rather than being spliced into the message text.
const apiLog = (context) => {
  const base = LoggerService.create('autofillApi');
  return context ? base.withContext(context) : base;
};

// Shown when the server turns a request away for want of a valid sign-in.
// Exported so the components can recognise it if they ever need to.
export const SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired - reload the page to sign in again.';
export const NOT_ALLOWED_MESSAGE = "Your account isn't allowed to do that.";

// UploaderService always answers with a JSON { error } body, so a non-JSON
// error response didn't come from it - it came from holly's nginx (or
// whatever sits in front), most often because /buswankers-api/ isn't being
// proxied. Say so: "Request failed (404)" on its own sent a real
// investigation down the wrong path once.
//
// The exception is a 401/403: the token check happens before the service's
// own code runs, so those come back with an empty body - which would
// otherwise be mistaken for the "not being proxied" case above.
export async function readErrorMessage(response, fallback) {
  if (response.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (response.status === 403) return NOT_ALLOWED_MESSAGE;

  try {
    const body = await response.json();
    if (body && body.error) return body.error;
  } catch {
    // response wasn't JSON - fall through
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return `${fallback} The reply came from the web server, not the upload service - ` +
      `${API_BASE} isn't being proxied to it (check the buswankers-api nginx include on holly).`;
  }
  return fallback;
}

// GET /files -> Map of filename -> { filename, size, lastModified, hash } for
// every autofill file currently in the store. hash is a short fingerprint of
// the file's content (see AutofillStore.HashOf) - what the out-of-date check
// compares, since lastModified moves on every ingest even when nothing
// changed; '' when the server couldn't work one out. A sale whose filename
// isn't in the map is "empty" (nothing ingested for it yet).
export async function fetchStoredFiles() {
  const response = await fetch(`${API_BASE}/files`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed (${response.status}).`));
  }
  const body = await response.json();
  const map = new Map();
  for (const f of body.files || []) {
    map.set(f.filename, f);
  }
  return map;
}

// Normalise one per-sheet result from POST /ingest: status is one of
// 'ok' | 'empty' | 'failed' (lower-cased here whatever casing the server's
// enum serialiser used); older responses carried only an `ok` boolean.
function normaliseIngestResult(r) {
  const status = r.status ? String(r.status).toLowerCase() : (r.ok ? 'ok' : 'failed');
  return { ...r, status, ok: status === 'ok' };
}

// The roster half of an ingest response: status 'ok' | 'empty' | 'failed' |
// 'skipped' (no roster sheet in the workbook), plus year/sheet/people when ok.
function normaliseRunningOrderResult(r) {
  if (!r) return null;
  const status = r.status ? String(r.status).toLowerCase() : 'skipped';
  return { ...r, status };
}

// POST /ingest -> { results, runningOrder }. `results` is the per-sale-sheet
// list; `runningOrder` is the roster outcome (see normaliseRunningOrderResult).
// Throws with the server's message on a non-2xx (signed-out or expired session,
// unreadable workbook, nothing ingested at all); when the server included
// per-sheet results with that error (it does for "no sheet could be ingested"),
// they're attached to the thrown Error as `results` so the page can show WHICH
// sheets failed and why, rather than just a status code.
//
// No password any more: the caller is identified by the Keycloak access token
// the fetch interceptor attaches to this request. Don't set a Content-Type
// header here - the browser must add the multipart boundary itself.
export async function ingestWorkbook(file) {
  apiLog({ fileName: file && file.name, fileBytes: file && file.size }).debug('Ingest request starting');

  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: form });
  apiLog({ status: response.status, ok: response.ok }).debug('Ingest response received');
  if (!response.ok) {
    let results = [];
    let message = `Request failed (${response.status}).`;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
        if (body && Array.isArray(body.results)) results = body.results.map(normaliseIngestResult);
      } catch {
        // fall through with the generic message
      }
    } else {
      message = await readErrorMessage(response, message);
    }
    const err = new Error(message);
    err.results = results;
    throw err;
  }
  const body = await response.json();
  return {
    results: (body.results || []).map(normaliseIngestResult),
    runningOrder: normaliseRunningOrderResult(body.runningOrder),
  };
}

// GET /running-order -> { year, sheet, generatedAt, entries: [{ regNumber,
// firstName, lastName, name, postCode }] } from the last ingested roster
// sheet, or null when nothing has been ingested yet (the server answers 404
// for that, which is a normal state rather than an error). postCode is ''
// when the roster sheet has no 'Postcode' column (2026-09-18).
export async function fetchRunningOrder() {
  const response = await fetch(`${API_BASE}/running-order`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed (${response.status}).`));
  }
  const body = await response.json();
  if (!body || typeof body.year !== 'number') return null;
  return { ...body, entries: Array.isArray(body.entries) ? body.entries : [] };
}

// Fetch a stored autofill file and parse it into its groups (see
// src/bookmarklet.js) - what the Documentation tab builds the per-group
// bookmarklets and copy/paste tables from. Same public route the Download
// button uses; null if the file isn't in the store.
export async function fetchAutofillGroups(filename) {
  const response = await fetch(downloadUrlFor(filename), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed (${response.status}).`));
  }
  const text = await response.text();
  return parseAutofillCsv(text);
}

// Public download URL for a stored autofill file (anonymous on the server - the
// AutoFill Options extension fetches it with no sign-in).
export function downloadUrlFor(filename) {
  return `${API_BASE}/files/${encodeURIComponent(filename)}`;
}

// Absolute URL for a sale's live, structured group data (see
// UploadServiceController.DownloadGroups) - the one URL in this file that has
// to be fully-qualified rather than relative. Every other call here runs from
// this app's own page, so a path relative to it is enough; this one is baked
// into a bookmarklet (see bookmarkletSource in ../bookmarklet.js) and fetched
// from wherever that bookmarklet is clicked - the actual registration page,
// on a domain this app has no way to know in advance. Built from
// window.location.origin (wherever this app itself is being served from -
// local dev, SIT, UAT, PRD) rather than a hardcoded domain, for the same
// reason.
export function groupsUrlFor(filename) {
  return `${window.location.origin}${API_BASE}/files/${encodeURIComponent(filename)}/groups`;
}

// Fetch a stored file and hand it to the browser as a download, rather than
// relying on <a download> (which is ignored for cross-path navigations in
// some browsers and gives no error feedback on a 404).
//
// Resolves to { hash }: the content hash of the bytes that were actually
// served, from the X-Autofill-Hash response header ('' if the server didn't
// send one). The caller records THIS as the version taken - not the hash from
// the earlier file listing - so a file re-ingested between the listing and
// the click is recorded as what was really downloaded.
export async function downloadStoredFile(filename) {
  const response = await fetch(downloadUrlFor(filename), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Download failed (${response.status}).`));
  }
  const hash = response.headers.get('X-Autofill-Hash') || '';
  const blob = await response.blob();
  saveBlob(blob, filename);
  return { hash };
}

export function saveBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
