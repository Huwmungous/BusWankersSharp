import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import LauncherHelperCard from './LauncherHelperCard';

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

const config = {
  url: 'https://glastonbury.seetickets.com/',
  saleAt: '2026-10-01T09:00',
  leadMs: 200,
  staggerMs: 300,
};

const setUserAgent = (ua) => {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
};

const zipResponse = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/zip' } });
const htmlFallback = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/html' } });

// Renders the card and lets its one-off "is the download really there?" check settle,
// so a test sees the card as a person would after it has finished loading.
const renderCard = async (cardConfig = config) => {
  await act(async () => {
    render(<LauncherHelperCard config={cardConfig} />);
  });
};

const originalFetch = globalThis.fetch;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  globalThis.fetch = vi.fn(zipResponse);
  window.matchMedia = undefined;
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('LauncherHelperCard on a computer', () => {
  test('Windows: a download for Windows and a ready-to-paste command', async () => {
    setUserAgent(WINDOWS);
    await renderCard();

    const link = screen.getByText('Download for Windows');
    expect(link.getAttribute('href')).toMatch(/\/launcher\/BusWankersLauncher-win-x64\.zip$/);
    expect(link.hasAttribute('download')).toBe(true);

    expect(screen.getByLabelText('Sale-day command').value).toBe(
      'BusWankersLauncher.exe --url https://glastonbury.seetickets.com/ --at 2026-10-01T09:00 --lead 200 --stagger 300',
    );
    expect(screen.getByLabelText('Rehearsal command').value).toContain('--rehearse 30');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('Mac: both builds are offered, with help choosing', async () => {
    setUserAgent(MAC);
    await renderCard();

    expect(screen.getByText('Download for Mac (Apple silicon)').getAttribute('href')).toMatch(/osx-arm64\.zip$/);
    expect(screen.getByText('Download for Mac (Intel)').getAttribute('href')).toMatch(/osx-x64\.zip$/);
    expect(screen.getByText(/About This Mac/)).toBeTruthy();
    expect(screen.getByLabelText('Sale-day command').value).toMatch(/^\.\/BusWankersLauncher --url /);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('Linux: its own build', async () => {
    setUserAgent(LINUX);
    await renderCard();
    expect(screen.getByText('Download for Linux').getAttribute('href')).toMatch(/linux-x64\.zip$/);
  });

  test('with no sale time set, the rehearsal is still there but the sale-day command waits', async () => {
    setUserAgent(WINDOWS);
    await renderCard({ ...config, saleAt: '' });

    expect(screen.getByLabelText('Rehearsal command')).toBeTruthy();
    expect(screen.queryByLabelText('Sale-day command')).toBeNull();
    expect(screen.getByText(/Set the sale time in the settings above/)).toBeTruthy();
  });

  test('a URL with a query string is quoted in the command', async () => {
    setUserAgent(LINUX);
    await renderCard({ ...config, url: 'https://x.test/tickets?event=1&day=2' });
    expect(screen.getByLabelText('Sale-day command').value).toContain("--url 'https://x.test/tickets?event=1&day=2'");
  });

  test('says so when the server has not published the helper (SPA fallback answers instead)', async () => {
    setUserAgent(WINDOWS);
    globalThis.fetch = vi.fn(htmlFallback);
    await renderCard();

    expect(screen.getByText(/hasn.t been published on this server yet/)).toBeTruthy();
  });

  test('does not cry wolf when the check itself fails (offline)', async () => {
    setUserAgent(WINDOWS);
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    await renderCard();

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(screen.queryByText(/hasn.t been published/)).toBeNull();
    expect(screen.getByText('Download for Windows')).toBeTruthy();
  });

  test('the installed app is told plainly that its launch window is not a real browser', async () => {
    setUserAgent(WINDOWS);
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    await renderCard();

    expect(screen.getByText(/You.re using the installed app/)).toBeTruthy();
    expect(screen.getByText(/not in Chrome/)).toBeTruthy();
  });

  test('a browser tab does not get the installed-app warning', async () => {
    setUserAgent(WINDOWS);
    await renderCard();
    expect(screen.queryByText(/You.re using the installed app/)).toBeNull();
  });
});

describe('LauncherHelperCard on a phone', () => {
  test('Android: tap-to-open links per browser, and no program to download', async () => {
    setUserAgent(ANDROID);
    await renderCard();

    const firefox = screen.getByText('Open in Firefox').getAttribute('href');
    expect(firefox).toContain('intent://glastonbury.seetickets.com/#Intent;scheme=https;package=org.mozilla.firefox;');
    expect(screen.getByText('Open in Chrome').getAttribute('href')).toContain('package=com.android.chrome');
    expect(screen.queryByText(/Download for/)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('Android: an unusable ticket URL gives no links rather than broken ones', async () => {
    setUserAgent(ANDROID);
    await renderCard({ ...config, url: 'not a url' });
    expect(screen.queryByText('Open in Firefox')).toBeNull();
  });

  test('iPhone: an honest explanation, nothing to download and no check made', async () => {
    setUserAgent(IPHONE);
    await renderCard();

    expect(screen.getByText(/don.t let a page start another browser/)).toBeTruthy();
    expect(screen.queryByText(/Download for/)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
