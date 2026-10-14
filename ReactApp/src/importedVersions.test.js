import { STORAGE_KEY, readTaken, updateStateFor } from './importedVersions';

// The out-of-date decision is the one piece of this feature that can be
// subtly wrong without anything visibly breaking, so it's pinned down here.

const file = (over = {}) => ({
  filename: 'coach_autofill.csv',
  size: 1200,
  lastModified: '2026-09-29T08:00:00+00:00',
  hash: 'aaaaaaaaaaaaaaaa',
  ...over,
});

describe('updateStateFor', () => {
  test('no stored file, or an empty one, is "empty"', () => {
    expect(updateStateFor(undefined, undefined)).toBe('empty');
    expect(updateStateFor(file({ size: 0 }), { hash: 'aaaaaaaaaaaaaaaa' })).toBe('empty');
  });

  test('a file this browser has never taken is "never"', () => {
    expect(updateStateFor(file(), undefined)).toBe('never');
  });

  test('the same hash is "current" even if lastModified has moved', () => {
    // An ingest of an unchanged spreadsheet rewrites the file: new timestamp,
    // same bytes. That must not raise a false "update available".
    const taken = { hash: 'aaaaaaaaaaaaaaaa', lastModified: '2026-09-20T08:00:00+00:00' };
    expect(updateStateFor(file(), taken)).toBe('current');
  });

  test('a different hash is "stale"', () => {
    const taken = { hash: 'bbbbbbbbbbbbbbbb', lastModified: '2026-09-29T08:00:00+00:00' };
    expect(updateStateFor(file(), taken)).toBe('stale');
  });

  test('without a hash on either side, lastModified decides', () => {
    const noHash = file({ hash: '' });
    expect(updateStateFor(noHash, { hash: '', lastModified: noHash.lastModified })).toBe('current');
    expect(updateStateFor(noHash, { hash: '', lastModified: '2026-09-01T00:00:00+00:00' })).toBe('stale');
  });

  test('a record made before the server sent hashes falls back to lastModified', () => {
    // Front end deployed first, back end later: the record has no hash but
    // the listing now does. Unchanged file -> still current, not a false alarm.
    expect(updateStateFor(file(), { hash: '', lastModified: file().lastModified })).toBe('current');
    expect(updateStateFor(file(), { hash: '', lastModified: '2026-09-01T00:00:00+00:00' })).toBe('stale');
  });
});

describe('readTaken', () => {
  beforeEach(() => window.localStorage.clear());

  test('nothing recorded reads as an empty record', () => {
    expect(readTaken()).toEqual({});
  });

  test('reads back what was stored', () => {
    const record = { 'coach_autofill.csv': { hash: 'aaaaaaaaaaaaaaaa', lastModified: 'x', at: 'y' } };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(readTaken()).toEqual(record);
  });

  test('corrupt or wrongly-shaped storage is treated as nothing recorded', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(readTaken()).toEqual({});
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']));
    expect(readTaken()).toEqual({});
    window.localStorage.setItem(STORAGE_KEY, 'null');
    expect(readTaken()).toEqual({});
  });
});
