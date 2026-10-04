import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';

// Whoever the mocked auth library says is signed in. Read when a hook runs
// (not when the mock is created), so each test sets it before rendering.
let currentUser = null;

vi.mock('@if/web-common', () => {
  const log = { debug: vi.fn(), warn: vi.fn(), withContext: () => log };
  return { LoggerService: { create: () => log } };
});
vi.mock('@if/web-common-react', () => ({ useAuth: () => ({ user: currentUser }) }));

import { DEFAULT_TAB, TABS, tabsFor, useActiveTab, useVisibleTabs } from './tabs';

const uploader = { profile: { groups: ['uploaders'] } };
const ordinaryUser = { profile: { groups: ['viewers'] } };

const ids = (tabs) => tabs.map((t) => t.id);

afterEach(() => {
  currentUser = null;
  window.location.hash = '';
});

describe('tabsFor', () => {
  test('an uploader sees every tab, Update Files first', () => {
    expect(ids(tabsFor(true))).toEqual(ids(TABS));
    expect(tabsFor(true)[0].id).toBe('update-files');
  });

  test('anyone else sees everything except Update Files', () => {
    expect(ids(tabsFor(false))).toEqual(['documentation', 'groups', 'registrations', 'running-order', 'test-form', 'launch']);
  });

  test('Update Files is the only uploaders-only tab', () => {
    expect(TABS.filter((t) => t.uploadersOnly).map((t) => t.id)).toEqual(['update-files']);
  });
});

describe('useVisibleTabs', () => {
  test('includes Update Files for a member of the uploaders group', () => {
    currentUser = uploader;
    const { result } = renderHook(() => useVisibleTabs());
    expect(ids(result.current)).toContain('update-files');
  });

  test('leaves Update Files out for a signed-in user outside the group', () => {
    currentUser = ordinaryUser;
    const { result } = renderHook(() => useVisibleTabs());
    expect(ids(result.current)).not.toContain('update-files');
  });
});

describe('useActiveTab', () => {
  test('an uploader can open #update-files', () => {
    currentUser = uploader;
    window.location.hash = '#update-files';
    const { result } = renderHook(() => useActiveTab());
    expect(result.current[0]).toBe('update-files');
  });

  test('a non-member who browses to #update-files lands on the landing tab instead', () => {
    currentUser = ordinaryUser;
    window.location.hash = '#update-files';
    const { result } = renderHook(() => useActiveTab());
    expect(result.current[0]).toBe(DEFAULT_TAB);
  });

  test('a non-member cannot select the tab programmatically', () => {
    currentUser = ordinaryUser;
    window.location.hash = '#groups';
    const { result } = renderHook(() => useActiveTab());

    act(() => result.current[1]('update-files'));

    expect(window.location.hash).toBe('#groups');
    expect(result.current[0]).toBe('groups');
  });

  test('the Registrations tab sits after Groups and is open to everyone signed in', () => {
    expect(ids(TABS).indexOf('registrations')).toBe(ids(TABS).indexOf('groups') + 1);
    expect(TABS.find((t) => t.id === 'registrations').uploadersOnly).toBeFalsy();

    currentUser = ordinaryUser;
    window.location.hash = '#registrations';
    const { result } = renderHook(() => useActiveTab());
    expect(result.current[0]).toBe('registrations');
  });

  test('other tabs still work for a non-member', () => {
    currentUser = ordinaryUser;
    window.location.hash = '#running-order';
    const { result } = renderHook(() => useActiveTab());
    expect(result.current[0]).toBe('running-order');
  });
});
