import { render, screen } from '@testing-library/react';
import InstallPrompt from './InstallPrompt';

// The component renders nothing when no install prompt is available (the normal case).
// When mounted it registers a beforeinstallprompt listener; we just verify it doesn't crash.
test('renders without crashing', () => {
  render(<InstallPrompt />);
});
