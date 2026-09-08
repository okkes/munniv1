// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePwa } from '@/app/pwa';
import { renderWithProviders } from '@/test/harness';
import { UpdateToast } from './UpdateToast';

describe('UpdateToast', () => {
  beforeEach(() => {
    localStorage.clear();
    usePwa.setState({ needRefresh: false, update: () => undefined });
  });

  it('renders nothing while no update is waiting', () => {
    renderWithProviders(<UpdateToast />);
    expect(screen.queryByTestId('pwa-update-toast')).toBeNull();
  });

  it('shows the localized message and triggers the update', () => {
    const update = vi.fn();
    usePwa.setState({ needRefresh: true, update });
    renderWithProviders(<UpdateToast />);
    expect(screen.getByTestId('pwa-update-toast').textContent).toContain('new version');
    fireEvent.click(screen.getByTestId('pwa-update-reload'));
    expect(update).toHaveBeenCalled();
  });

  it('dismiss hides the toast without updating', () => {
    const update = vi.fn();
    usePwa.setState({ needRefresh: true, update });
    renderWithProviders(<UpdateToast />);
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(screen.queryByTestId('pwa-update-toast')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
