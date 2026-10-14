import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// The shared auth library is mocked: only the sign-out hand-over is under test.
const signout = vi.fn();
vi.mock('@if/web-common', () => {
  const log = { debug: vi.fn(), warn: vi.fn(), withContext: () => log };
  return {
    authService: { signout: (...args) => signout(...args) },
    LoggerService: { create: () => log },
  };
});

import LogoutButton from './LogoutButton';

beforeEach(() => {
  signout.mockReset();
});

test('starts the Keycloak sign-out when clicked', async () => {
  signout.mockResolvedValue(undefined);
  render(<LogoutButton />);

  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

  await waitFor(() => expect(signout).toHaveBeenCalledTimes(1));
});

test('offers a retry if the sign-out could not start', async () => {
  signout.mockRejectedValue(new Error('no end-session endpoint'));
  render(<LogoutButton />);

  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

  const retry = await screen.findByRole('button', { name: 'Log out (retry)' });
  expect(retry.disabled).toBe(false);
});
