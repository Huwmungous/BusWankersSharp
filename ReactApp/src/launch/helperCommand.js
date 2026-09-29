// The native launcher helper (see LauncherHelper/ in the repo): a small program
// people download and run on their own computer, because a web page - and an
// installed web app, which is only a page in a window of its own - cannot start
// Chrome, Firefox or Edge. This file is everything the Launcher tab needs to
// hand it over: which download suits this device, the command line for the
// person's settings, and (for Android, where a page CAN open another browser,
// but only when tapped) the intent links.
//
// All pure functions, so they can be tested without a browser or a component.

export const HELPER_PROGRAM = 'BusWankersLauncher';

// How many seconds ahead of "now" a rehearsal command jumps.
export const HELPER_REHEARSAL_SECONDS = 30;

// One zip per platform, published to <site>/launcher/ by
// LauncherHelper/publish-launcher.sh during the frontend deploy.
export const HELPER_DOWNLOADS = Object.freeze([
  Object.freeze({ id: 'windows', label: 'Windows', file: 'BusWankersLauncher-win-x64.zip' }),
  Object.freeze({ id: 'mac-arm', label: 'Mac (Apple silicon)', file: 'BusWankersLauncher-osx-arm64.zip' }),
  Object.freeze({ id: 'mac-intel', label: 'Mac (Intel)', file: 'BusWankersLauncher-osx-x64.zip' }),
  Object.freeze({ id: 'linux', label: 'Linux', file: 'BusWankersLauncher-linux-x64.zip' }),
]);

// Which browser packages a phone's page may be asked to open. A tap on the
// matching link opens the ticket page in that app, if it's installed; if it
// isn't, Android falls back to the plain link.
export const ANDROID_BROWSERS = Object.freeze([
  Object.freeze({ id: 'chrome', label: 'Chrome', packageName: 'com.android.chrome' }),
  Object.freeze({ id: 'firefox', label: 'Firefox', packageName: 'org.mozilla.firefox' }),
  Object.freeze({ id: 'edge', label: 'Edge', packageName: 'com.microsoft.emmx' }),
  Object.freeze({ id: 'samsung', label: 'Samsung Internet', packageName: 'com.sec.android.app.sbrowser' }),
  Object.freeze({ id: 'opera', label: 'Opera', packageName: 'com.opera.browser' }),
  Object.freeze({ id: 'brave', label: 'Brave', packageName: 'com.brave.browser' }),
  Object.freeze({ id: 'duckduckgo', label: 'DuckDuckGo', packageName: 'com.duckduckgo.mobile.android' }),
]);

// 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other'. Android is
// tested first because its user agent also says "Linux".
export function detectPlatform(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/CrOS/i.test(ua)) return 'other';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

// The downloads worth showing first for a platform. A Mac's user agent says
// "Intel" even on Apple silicon, so both Mac builds are offered.
export function downloadsFor(platform) {
  const pick = (...ids) => ids.map((id) => HELPER_DOWNLOADS.find((d) => d.id === id));
  switch (platform) {
    case 'windows':
      return pick('windows');
    case 'mac':
      return pick('mac-arm', 'mac-intel');
    case 'linux':
      return pick('linux');
    default:
      return [...HELPER_DOWNLOADS];
  }
}

export function helperDownloadUrl(file, base = process.env.PUBLIC_URL || '') {
  return `${base}/launcher/${file}`;
}

// A download that isn't there is answered by the site with its own index.html
// (the SPA fallback), status 200 - so "ok" alone doesn't prove the zip exists.
export function looksLikeDownload(response) {
  if (!response || !response.ok) return false;
  const type = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-type') || ''
    : '';
  return !/text\/html/i.test(type);
}

const SAFE_TOKEN = /^[A-Za-z0-9_./:=@%+-]+$/;

// Quotes one argument for the shell the person is likely using: double quotes
// for Windows (cmd and PowerShell both accept them), single quotes elsewhere.
// Plain tokens are left alone so the command stays readable.
export function quoteArg(value, platform) {
  const text = String(value);
  if (SAFE_TOKEN.test(text)) return text;
  if (platform === 'windows') return `"${text.replace(/"/g, '\\"')}"`;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

// The arguments for the person's settings. Names and meanings match the
// helper's own (--url, --at, --lead, --stagger) and this page's settings.
// Rehearsal replaces the sale time, exactly as the page's Rehearse button does.
export function buildHelperArgs(config, { rehearse = false } = {}) {
  const args = ['--url', config.url];
  if (rehearse) {
    args.push('--rehearse', String(HELPER_REHEARSAL_SECONDS));
  } else if (config.saleAt) {
    args.push('--at', config.saleAt);
  }
  args.push('--lead', String(config.leadMs), '--stagger', String(config.staggerMs));
  return args;
}

// The whole command line, ready to paste, or null when there's nothing to say
// yet (a real run needs a sale time).
export function buildHelperCommand(config, platform, { rehearse = false } = {}) {
  if (!config || !config.url) return null;
  if (!rehearse && !config.saleAt) return null;
  const program = platform === 'windows' ? `${HELPER_PROGRAM}.exe` : `./${HELPER_PROGRAM}`;
  const args = buildHelperArgs(config, { rehearse }).map((a) => quoteArg(a, platform));
  return [program, ...args].join(' ');
}

// An Android "intent" link: tapping it opens the ticket page in the named
// browser app. Chrome only follows one from a tap, never from a timer, which is
// why this is a button people press at the moment rather than something the
// page can do for them. The original address is the fallback if the app isn't
// installed. Null for anything that isn't a plain http(s) address.
export function androidIntentUrl(url, packageName) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const scheme = parsed.protocol.slice(0, -1);
  const target = `${parsed.host}${parsed.pathname}${parsed.search}`;
  return `intent://${target}#Intent;scheme=${scheme};package=${packageName};S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
