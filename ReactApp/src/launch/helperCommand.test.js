import {
  ANDROID_BROWSERS,
  HELPER_DOWNLOADS,
  androidIntentUrl,
  buildHelperArgs,
  buildHelperCommand,
  detectPlatform,
  downloadsFor,
  helperDownloadUrl,
  looksLikeDownload,
  quoteArg,
} from './helperCommand';

const config = {
  url: 'https://glastonbury.seetickets.com/',
  saleAt: '2026-10-01T09:00',
  leadMs: 200,
  staggerMs: 300,
};

describe('detectPlatform', () => {
  test.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', 'mac'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0', 'linux'],
    ['Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 Chrome/120', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'ios'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120', 'other'],
  ])('%s', (ua, expected) => {
    expect(detectPlatform(ua)).toBe(expected);
  });

  test('Android wins over the "Linux" in its user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 13)')).toBe('android');
  });

  test('anything unreadable is "other"', () => {
    expect(detectPlatform('')).toBe('other');
    expect(detectPlatform(undefined)).toBe('other');
    expect(detectPlatform(null)).toBe('other');
    expect(detectPlatform(42)).toBe('other');
  });
});

describe('downloadsFor', () => {
  test('Windows and Linux get their one build', () => {
    expect(downloadsFor('windows').map((d) => d.id)).toEqual(['windows']);
    expect(downloadsFor('linux').map((d) => d.id)).toEqual(['linux']);
  });

  test('a Mac is offered both builds, since its user agent cannot tell Intel from Apple silicon', () => {
    expect(downloadsFor('mac').map((d) => d.id)).toEqual(['mac-arm', 'mac-intel']);
  });

  test('phones and unknown devices are shown every build', () => {
    expect(downloadsFor('android')).toHaveLength(HELPER_DOWNLOADS.length);
    expect(downloadsFor('other')).toHaveLength(HELPER_DOWNLOADS.length);
  });

  test('every download is a zip named for its platform', () => {
    for (const d of HELPER_DOWNLOADS) expect(d.file).toMatch(/^BusWankersLauncher-[a-z0-9-]+\.zip$/);
  });
});

describe('helperDownloadUrl', () => {
  test('lives under the launcher folder of the site', () => {
    expect(helperDownloadUrl('BusWankersLauncher-win-x64.zip', '/buswankers')).toBe(
      '/buswankers/launcher/BusWankersLauncher-win-x64.zip',
    );
  });
});

describe('looksLikeDownload', () => {
  const response = (ok, type) => ({ ok, headers: { get: () => type } });

  test('a zip is a download', () => {
    expect(looksLikeDownload(response(true, 'application/zip'))).toBe(true);
    expect(looksLikeDownload(response(true, 'application/octet-stream'))).toBe(true);
  });

  test('the SPA fallback (200, HTML) is not', () => {
    expect(looksLikeDownload(response(true, 'text/html; charset=utf-8'))).toBe(false);
  });

  test('an error, or no response at all, is not', () => {
    expect(looksLikeDownload(response(false, 'application/zip'))).toBe(false);
    expect(looksLikeDownload(null)).toBe(false);
  });

  test('a response with no content type given is not ruled out', () => {
    expect(looksLikeDownload({ ok: true })).toBe(true);
    expect(looksLikeDownload(response(true, null))).toBe(true);
  });
});

describe('quoteArg', () => {
  test('plain tokens are left alone', () => {
    expect(quoteArg('--url', 'windows')).toBe('--url');
    expect(quoteArg('https://glastonbury.seetickets.com/', 'linux')).toBe('https://glastonbury.seetickets.com/');
    expect(quoteArg('2026-10-01T09:00', 'mac')).toBe('2026-10-01T09:00');
    expect(quoteArg('-50', 'windows')).toBe('-50');
  });

  test('a URL with a query string is quoted, so & cannot end the command', () => {
    expect(quoteArg('https://x.test/?a=1&b=2', 'linux')).toBe("'https://x.test/?a=1&b=2'");
    expect(quoteArg('https://x.test/?a=1&b=2', 'windows')).toBe('"https://x.test/?a=1&b=2"');
  });

  test('embedded quotes are escaped for the shell in use', () => {
    expect(quoteArg("it's", 'linux')).toBe("'it'\\''s'");
    expect(quoteArg('say "hi"', 'windows')).toBe('"say \\"hi\\""');
  });

  test('a date-and-time typed with a space is quoted', () => {
    expect(quoteArg('2026-10-01 09:00', 'windows')).toBe('"2026-10-01 09:00"');
  });
});

describe('buildHelperArgs', () => {
  test('carries the page settings under the helper\'s option names', () => {
    expect(buildHelperArgs(config)).toEqual([
      '--url', 'https://glastonbury.seetickets.com/',
      '--at', '2026-10-01T09:00',
      '--lead', '200',
      '--stagger', '300',
    ]);
  });

  test('a rehearsal swaps the sale time for --rehearse', () => {
    expect(buildHelperArgs(config, { rehearse: true })).toEqual([
      '--url', 'https://glastonbury.seetickets.com/',
      '--rehearse', '30',
      '--lead', '200',
      '--stagger', '300',
    ]);
  });
});

describe('buildHelperCommand', () => {
  test('Windows runs the .exe', () => {
    expect(buildHelperCommand(config, 'windows')).toBe(
      'BusWankersLauncher.exe --url https://glastonbury.seetickets.com/ --at 2026-10-01T09:00 --lead 200 --stagger 300',
    );
  });

  test('Mac and Linux run it from the current folder', () => {
    expect(buildHelperCommand(config, 'mac')).toMatch(/^\.\/BusWankersLauncher --url /);
    expect(buildHelperCommand(config, 'linux')).toMatch(/^\.\/BusWankersLauncher --url /);
  });

  test('a rehearsal command needs no sale time', () => {
    const noTime = { ...config, saleAt: '' };
    expect(buildHelperCommand(noTime, 'linux', { rehearse: true })).toBe(
      './BusWankersLauncher --url https://glastonbury.seetickets.com/ --rehearse 30 --lead 200 --stagger 300',
    );
  });

  test('a real run without a sale time gives no command', () => {
    expect(buildHelperCommand({ ...config, saleAt: '' }, 'windows')).toBeNull();
  });

  test('no settings, no command', () => {
    expect(buildHelperCommand(null, 'windows')).toBeNull();
    expect(buildHelperCommand({ ...config, url: '' }, 'windows')).toBeNull();
  });

  test('a URL with a query string is quoted in the command', () => {
    const c = { ...config, url: 'https://x.test/tickets?event=1&day=2' };
    expect(buildHelperCommand(c, 'linux')).toContain("--url 'https://x.test/tickets?event=1&day=2'");
  });
});

describe('androidIntentUrl', () => {
  test('names the browser package and keeps the address as the fallback', () => {
    const url = androidIntentUrl('https://glastonbury.seetickets.com/', 'org.mozilla.firefox');
    expect(url).toBe(
      'intent://glastonbury.seetickets.com/#Intent;scheme=https;package=org.mozilla.firefox;'
        + 'S.browser_fallback_url=https%3A%2F%2Fglastonbury.seetickets.com%2F;end',
    );
  });

  test('keeps the path and query, and a non-default port', () => {
    const url = androidIntentUrl('http://example.test:8080/a/b?x=1&y=2', 'com.android.chrome');
    expect(url).toContain('intent://example.test:8080/a/b?x=1&y=2#Intent;scheme=http;package=com.android.chrome;');
  });

  test('is null for anything that is not a plain web address', () => {
    expect(androidIntentUrl('not a url', 'com.android.chrome')).toBeNull();
    expect(androidIntentUrl('ftp://example.test/', 'com.android.chrome')).toBeNull();
    expect(androidIntentUrl('javascript:alert(1)', 'com.android.chrome')).toBeNull();
  });

  test('every listed browser has a package name and a label', () => {
    for (const b of ANDROID_BROWSERS) {
      expect(b.packageName).toMatch(/^[a-z]+(\.[a-z0-9]+)+$/);
      expect(b.label).toBeTruthy();
    }
  });
});
