import { vi } from 'vitest';

// The hook needs the auth library; only the plain function is under test here.
vi.mock('@if/web-common-react', () => ({ useAuth: () => ({ user: null }) }));

import { isClearAllUser, CLEAR_ALL_USER } from './clearAll';

describe('isClearAllUser', () => {
  it('is CampDad, whatever the case', () => {
    expect(CLEAR_ALL_USER).toBe('CampDad');
    expect(isClearAllUser({ profile: { preferred_username: 'CampDad' } })).toBe(true);
    expect(isClearAllUser({ profile: { preferred_username: 'campdad' } })).toBe(true);
    expect(isClearAllUser({ profile: { preferred_username: ' CAMPDAD ' } })).toBe(true);
  });

  it('is nobody else', () => {
    expect(isClearAllUser({ profile: { preferred_username: 'wanker' } })).toBe(false);
    expect(isClearAllUser({ profile: { preferred_username: 'CampDad2' } })).toBe(false);
    expect(isClearAllUser({ profile: {} })).toBe(false);
    expect(isClearAllUser({})).toBe(false);
    expect(isClearAllUser(null)).toBe(false);
    expect(isClearAllUser(undefined)).toBe(false);
    expect(isClearAllUser({ profile: { preferred_username: 42 } })).toBe(false);
  });
});
