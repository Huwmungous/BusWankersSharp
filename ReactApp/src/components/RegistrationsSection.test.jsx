import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// The server calls, the clipboard and the logger are mocked: what is under test
// is what the tab does with the server's answers.
const api = vi.hoisted(() => ({
  openRegistrations: vi.fn(),
  fetchNextRegistration: vi.fn(),
  claimRegistration: vi.fn(),
  clearRegistrations: vi.fn(),
}));
const clipboard = vi.hoisted(() => ({ copyWhenReady: vi.fn() }));

vi.mock('../api/registrationsApi', () => api);
vi.mock('../clipboard', () => clipboard);
vi.mock('../log', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLog: () => log, asError: (e) => e };
});

import RegistrationsSection, { ALL_ALLOCATED_MESSAGE, HELD_BY_OTHERS_MESSAGE, NOT_LOADED_MESSAGE } from './RegistrationsSection';

const entry = (regNumber, postCode, mine = false) => ({ regNumber, postCode, allocated: mine, mine });
const state = (overrides = {}) => ({ loaded: true, total: 3, remaining: 3, allAllocated: false, heldByOthers: false, entry: entry('1111111', 'AB1 2CD'), ...overrides });

// A stand-in for copyWhenReady that behaves like the real one: waits for the
// promised text and reports a successful copy of it (or nothing, for null).
const copyAsRealOne = async (textPromise) => {
  const text = await textPromise;
  return { text, copied: text != null };
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  clipboard.copyWhenReady.mockReset();
  clipboard.copyWhenReady.mockImplementation(copyAsRealOne);
});

test('shows the current registration and how many are left', async () => {
  api.openRegistrations.mockResolvedValue(state());
  render(<RegistrationsSection />);

  expect(await screen.findByText('1111111')).toBeTruthy();
  expect(screen.getByText('AB1 2CD')).toBeTruthy();
  expect(screen.getByText('3 of 3 still available')).toBeTruthy();
  expect(api.claimRegistration).not.toHaveBeenCalled(); // opening holds, it does not take
});

test('has a Copy button for each of the registration number and the postcode', async () => {
  api.openRegistrations.mockResolvedValue(state());
  render(<RegistrationsSection />);
  await screen.findByText('1111111');

  expect(screen.getByRole('button', { name: 'Copy the registration number' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy the postcode' })).toBeTruthy();
});

test('Copy reserves the pair first and then copies the value that was asked for', async () => {
  api.openRegistrations.mockResolvedValue(state());
  api.claimRegistration.mockResolvedValue({
    claimed: true,
    reason: null,
    state: state({ remaining: 2, entry: entry('1111111', 'AB1 2CD', true) }),
  });
  render(<RegistrationsSection />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Copy the postcode' }));

  await waitFor(() => expect(screen.getByText('Reserved for you')).toBeTruthy());
  expect(api.claimRegistration).toHaveBeenCalledWith('1111111');
  const textPromise = clipboard.copyWhenReady.mock.calls[0][0];
  await expect(textPromise).resolves.toBe('AB1 2CD');
  expect(screen.getByText('2 of 3 still available')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copy the postcode' }).textContent).toBe('Copied');
});

test('if the pair has gone elsewhere nothing is copied and the next registration is shown', async () => {
  api.openRegistrations.mockResolvedValue(state());
  api.claimRegistration.mockResolvedValue({
    claimed: false,
    reason: 'taken',
    state: state({ remaining: 2, entry: entry('2222222', 'EF3 4GH') }),
  });
  render(<RegistrationsSection />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Copy the registration number' }));

  expect(await screen.findByText('2222222')).toBeTruthy();
  expect(screen.getByText(/nothing was copied/)).toBeTruthy();
  const textPromise = clipboard.copyWhenReady.mock.calls[0][0];
  await expect(textPromise).resolves.toBeNull();
  expect(screen.queryByText('Reserved for you')).toBeNull();
});

test('says so when the claim is made but the browser refuses the clipboard', async () => {
  api.openRegistrations.mockResolvedValue(state());
  api.claimRegistration.mockResolvedValue({
    claimed: true,
    reason: null,
    state: state({ remaining: 2, entry: entry('1111111', 'AB1 2CD', true) }),
  });
  clipboard.copyWhenReady.mockImplementation(async (p) => ({ text: await p, copied: false }));
  render(<RegistrationsSection />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Copy the registration number' }));

  expect(await screen.findByText(/would not let us copy it/)).toBeTruthy();
  expect(screen.getByText('Reserved for you')).toBeTruthy();
});

test('Next asks for the entry after the one on screen and shows it, taking nothing', async () => {
  api.openRegistrations.mockResolvedValue(state());
  api.fetchNextRegistration.mockResolvedValue(state({ entry: entry('2222222', 'EF3 4GH') }));
  render(<RegistrationsSection />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByText('2222222')).toBeTruthy();
  expect(api.fetchNextRegistration).toHaveBeenCalledWith('1111111');
  expect(api.claimRegistration).not.toHaveBeenCalled();
});

test('when everything is allocated it says "All Registrations have been allocated" and Next is disabled', async () => {
  api.openRegistrations.mockResolvedValue(state({ remaining: 0, allAllocated: true, entry: null }));
  render(<RegistrationsSection />);

  expect(await screen.findByText(ALL_ALLOCATED_MESSAGE)).toBeTruthy();
  expect(ALL_ALLOCATED_MESSAGE).toBe('All Registrations have been allocated');
  expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull();
});

test('the message appears as soon as the last registration is copied', async () => {
  api.openRegistrations.mockResolvedValue(state({ remaining: 1, total: 3 }));
  api.claimRegistration.mockResolvedValue({
    claimed: true,
    reason: null,
    state: state({ remaining: 0, allAllocated: true, entry: entry('1111111', 'AB1 2CD', true) }),
  });
  render(<RegistrationsSection />);
  await screen.findByText('1111111');
  expect(screen.queryByText(ALL_ALLOCATED_MESSAGE)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Copy the registration number' }));

  expect(await screen.findByText(ALL_ALLOCATED_MESSAGE)).toBeTruthy();
  // The person who took the last one can still see (and re-copy) it.
  expect(screen.getByText('1111111')).toBeTruthy();
});

test('says so when no registrations have been loaded yet', async () => {
  api.openRegistrations.mockResolvedValue({ loaded: false, total: 0, remaining: 0, allAllocated: false, entry: null });
  render(<RegistrationsSection />);

  expect(await screen.findByText(NOT_LOADED_MESSAGE)).toBeTruthy();
  expect(screen.queryByText(ALL_ALLOCATED_MESSAGE)).toBeNull();
});

test('offers a retry when the registrations cannot be loaded', async () => {
  api.openRegistrations.mockRejectedValueOnce(new Error('Your sign-in has expired - reload the page to sign in again.'));
  api.openRegistrations.mockResolvedValueOnce(state());
  render(<RegistrationsSection />);

  expect(await screen.findByText(/sign-in has expired/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('1111111')).toBeTruthy();
});

test('re-reads the pool when a new spreadsheet has been loaded (reloadKey changes)', async () => {
  api.openRegistrations.mockResolvedValue(state());
  const { rerender } = render(<RegistrationsSection reloadKey={0} />);
  await screen.findByText('1111111');
  expect(api.openRegistrations).toHaveBeenCalledTimes(1);

  rerender(<RegistrationsSection reloadKey={1} />);

  await waitFor(() => expect(api.openRegistrations).toHaveBeenCalledTimes(2));
});

test('shows a held (not yet taken) pair as held, and a taken one as reserved', async () => {
  api.openRegistrations.mockResolvedValue(state());
  render(<RegistrationsSection />);

  expect(await screen.findByText(/Held for you/)).toBeTruthy();
  expect(screen.queryByText('Reserved for you')).toBeNull();
});

test('does not open anything on the server until the tab is active', async () => {
  api.openRegistrations.mockResolvedValue(state());
  const { rerender } = render(<RegistrationsSection active={false} />);
  await Promise.resolve();
  expect(api.openRegistrations).not.toHaveBeenCalled();

  rerender(<RegistrationsSection active />);

  expect(await screen.findByText('1111111')).toBeTruthy();
  expect(api.openRegistrations).toHaveBeenCalledTimes(1);
});

test('opens again each time the tab is returned to', async () => {
  api.openRegistrations.mockResolvedValue(state());
  const { rerender } = render(<RegistrationsSection active />);
  await screen.findByText('1111111');

  rerender(<RegistrationsSection active={false} />);
  rerender(<RegistrationsSection active />);

  await waitFor(() => expect(api.openRegistrations).toHaveBeenCalledTimes(2));
  expect(screen.getByText('1111111')).toBeTruthy(); // no flash of "Loading…"
});

test('says the rest are being held by others when none is free but some remain', async () => {
  api.openRegistrations.mockResolvedValue(state({ remaining: 2, heldByOthers: true, entry: null }));
  render(<RegistrationsSection />);

  expect(await screen.findByText(HELD_BY_OTHERS_MESSAGE)).toBeTruthy();
  expect(screen.queryByText(ALL_ALLOCATED_MESSAGE)).toBeNull();
});

test('there is no Clear all button unless the user is allowed it', async () => {
  api.openRegistrations.mockResolvedValue(state());
  render(<RegistrationsSection />);
  await screen.findByText('1111111');

  expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
});

test('Clear all asks first, then clears and opens a fresh pair', async () => {
  api.openRegistrations.mockResolvedValue(state());
  api.clearRegistrations.mockResolvedValue({ cleared: 2, state: state() });
  render(<RegistrationsSection canClearAll />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(api.clearRegistrations).not.toHaveBeenCalled(); // only asked so far

  fireEvent.click(screen.getByRole('button', { name: 'Yes, clear all' }));

  expect(await screen.findByText(/2 taken registrations were released/)).toBeTruthy();
  expect(api.clearRegistrations).toHaveBeenCalledTimes(1);
  expect(api.openRegistrations).toHaveBeenCalledTimes(2); // the tab re-opened
});

test('Cancel leaves everything as it was', async () => {
  api.openRegistrations.mockResolvedValue(state());
  render(<RegistrationsSection canClearAll />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(api.clearRegistrations).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy();
});

test('says so when the server refuses the clear', async () => {
  api.openRegistrations.mockResolvedValue(state());
  api.clearRegistrations.mockRejectedValue(new Error('Only CampDad can clear all the registrations.'));
  render(<RegistrationsSection canClearAll />);
  await screen.findByText('1111111');

  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, clear all' }));

  expect(await screen.findByText(/Only CampDad can clear/)).toBeTruthy();
});
