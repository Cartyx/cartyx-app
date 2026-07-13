import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '~/components/mainview/SettingsPanel';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'campaign-123' }),
}));

vi.mock('~/hooks/useCampaigns');

// Stub the modals so SettingsPanel tests don't depend on their internals;
// each modal has its own dedicated test coverage.
vi.mock('~/components/mainview/settings/GameSettingsModal', () => ({
  GameSettingsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="game-settings-modal">
        <button type="button" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock('~/components/mainview/settings/SrdLicensingModal', () => ({
  SrdLicensingModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="srd-licensing-modal">
        System Reference Document 5.2.1
        <button type="button" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

const { useCampaign } = await import('~/hooks/useCampaigns');
const mockUseCampaign = useCampaign as unknown as ReturnType<typeof vi.fn>;

describe('SettingsPanel', () => {
  beforeEach(() => {
    mockUseCampaign.mockReset();
  });

  it('renders the panel container', () => {
    mockUseCampaign.mockReturnValue({ campaign: { isGM: true } });
    render(<SettingsPanel />);
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
  });

  it('shows the Game Settings entry for a GM', () => {
    mockUseCampaign.mockReturnValue({ campaign: { isGM: true } });
    render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: /Game Settings/ })).toBeInTheDocument();
  });

  it('hides the Game Settings entry for a non-GM', () => {
    mockUseCampaign.mockReturnValue({ campaign: { isGM: false } });
    render(<SettingsPanel />);
    expect(screen.queryByRole('button', { name: /Game Settings/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SRD Licensing/ })).toBeInTheDocument();
  });

  it('opens the Game Settings modal when the entry is clicked', async () => {
    mockUseCampaign.mockReturnValue({ campaign: { isGM: true } });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    expect(screen.queryByTestId('game-settings-modal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Game Settings/ }));
    expect(screen.getByTestId('game-settings-modal')).toBeInTheDocument();
  });

  it('shows the SRD Licensing entry for a non-GM and opens the modal with attribution', async () => {
    mockUseCampaign.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    expect(screen.queryByTestId('srd-licensing-modal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /SRD Licensing/ }));
    expect(screen.getByTestId('srd-licensing-modal')).toBeInTheDocument();
    expect(screen.getByText(/System Reference Document 5\.2\.1/)).toBeInTheDocument();
  });
});
