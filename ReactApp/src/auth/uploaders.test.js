import { vi } from 'vitest';

// The auth library is mocked: only the group logic is under test.
vi.mock('@if/web-common', () => {
  const log = { debug: vi.fn(), warn: vi.fn(), withContext: () => log };
  return { LoggerService: { create: () => log } };
});
vi.mock('@if/web-common-react', () => ({ useAuth: () => ({ user: null }) }));

import { groupsOf, isUploader, UPLOADERS_GROUP } from './uploaders';

const userIn = (groups) => ({ profile: { groups } });

describe('isUploader', () => {
  test('the group is "uploaders"', () => {
    expect(UPLOADERS_GROUP).toBe('uploaders');
  });

  test('true when the groups claim lists uploaders', () => {
    expect(isUploader(userIn(['uploaders']))).toBe(true);
  });

  test('true among other groups', () => {
    expect(isUploader(userIn(['viewers', 'uploaders', 'admins']))).toBe(true);
  });

  test('true when the Keycloak mapper emits full group paths', () => {
    expect(isUploader(userIn(['/uploaders']))).toBe(true);
  });

  test('true when a single group arrives as a plain string', () => {
    expect(isUploader(userIn('uploaders'))).toBe(true);
  });

  test('false for other groups', () => {
    expect(isUploader(userIn(['viewers']))).toBe(false);
  });

  test('false for a nested group that merely ends in the same name', () => {
    expect(isUploader(userIn(['/team/uploaders']))).toBe(false);
  });

  test('false, case-sensitively, for a different capitalisation', () => {
    expect(isUploader(userIn(['Uploaders']))).toBe(false);
  });

  test('false when the token carries no groups claim (no Keycloak mapper)', () => {
    expect(isUploader({ profile: { preferred_username: 'wanker' } })).toBe(false);
  });

  test('false for no user, no profile, or a claim of the wrong type', () => {
    expect(isUploader(null)).toBe(false);
    expect(isUploader(undefined)).toBe(false);
    expect(isUploader({})).toBe(false);
    expect(isUploader(userIn({ uploaders: true }))).toBe(false);
    expect(isUploader(userIn(42))).toBe(false);
  });
});

describe('groupsOf', () => {
  test('normalises slashes and whitespace and drops empties', () => {
    expect(groupsOf(userIn(['/uploaders', ' viewers ', '', '/', null]))).toEqual(['uploaders', 'viewers']);
  });

  test('is empty when there is nothing to read', () => {
    expect(groupsOf(null)).toEqual([]);
    expect(groupsOf({ profile: {} })).toEqual([]);
  });
});
