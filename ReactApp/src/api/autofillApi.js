// Thin client for the UploaderService autofill API, shared by the upload bar
// at the top of the page, the documentation section's dropdown/download
// button, and the generate-and-download form at the bottom.
//
// Sibling path to the frontend's own base (PUBLIC_URL=/buswankers) - proxied by
// holly's nginx to the UploaderService backend running on intelligence. See
// ops/nginx/buswankers-api.inc. Fixed from the domain root rather than built off
// PUBLIC_URL, since this API isn't served under /buswankers/ itself.
export const API_BASE = '/buswankers-api/api/autofill';

export async function readErrorMessage(response, fallback) {
  try {
    const body = await response.json();
    if (body && body.error) return body.error;
  } catch {
    // response wasn't JSON - fall back to the generic message
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

// POST /ingest -> per-sheet results. Throws with the server's message on a
// non-2xx (wrong password, unreadable workbook, nothing ingested at all).
export async function ingestWorkbook(file, password) {
  const form = new FormData();
  form.append('file', file);
  form.append('password', password);

  const response = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed (${response.status}).`));
  }
  const body = await response.json();
  return body.results || [];
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
