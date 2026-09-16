// Thin client for the UploaderService autofill API, shared by the upload bar
// at the top of the page, the documentation section's dropdown/download
// button, and the generate-and-download form at the bottom.
//
// Sibling path to the frontend's own base (PUBLIC_URL=/buswankers) - proxied by
// holly's nginx to the UploaderService backend running on intelligence. See
// ops/nginx/buswankers-api.inc. Fixed from the domain root rather than built off
// PUBLIC_URL, since this API isn't served under /buswankers/ itself.
export const API_BASE = '/buswankers-api/api/autofill';

// UploaderService always answers with a JSON { error } body, so a non-JSON
// error response didn't come from it - it came from holly's nginx (or
// whatever sits in front), most often because /buswankers-api/ isn't being
// proxied. Say so: "Request failed (404)" on its own sent a real
// investigation down the wrong path once.
export async function readErrorMessage(response, fallback) {
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

// GET /files -> Map of filename -> { filename, size, lastModified } for every
// autofill file currently in the store. A sale whose filename isn't in the map
// is "empty" (nothing ingested for it yet).
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
// Throws with the server's message on a non-2xx (wrong password, unreadable
// workbook, nothing ingested at all); when the server included per-sheet
// results with that error (it does for "no sheet could be ingested"), they're
// attached to the thrown Error as `results` so the page can show WHICH sheets
// failed and why, rather than just a status code.
export async function ingestWorkbook(file, password) {
  const form = new FormData();
  form.append('file', file);
  form.append('password', password);

  const response = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: form });
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
// firstName, lastName, name }] } from the last ingested roster sheet, or null
// when nothing has been ingested yet (the server answers 404 for that, which
// is a normal state rather than an error).
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

// Public download URL for a stored autofill file (no password needed).
export function downloadUrlFor(filename) {
  return `${API_BASE}/files/${encodeURIComponent(filename)}`;
}

// Fetch a stored file and hand it to the browser as a download, rather than
// relying on <a download> (which is ignored for cross-path navigations in
// some browsers and gives no error feedback on a 404).
export async function downloadStoredFile(filename) {
  const response = await fetch(downloadUrlFor(filename), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Download failed (${response.status}).`));
  }
  const blob = await response.blob();
  saveBlob(blob, filename);
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
