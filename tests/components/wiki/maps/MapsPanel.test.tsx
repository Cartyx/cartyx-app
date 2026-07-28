import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapsPanel } from '~/components/wiki/maps/MapsPanel';
import { useMapsList, useActiveMap, useMapsMutations } from '~/hooks/useMaps';
import { useCampaign } from '~/hooks/useCampaigns';

/**
 * MapsPanel confirmed deletes with the native `window.confirm()` while every
 * other wiki panel used the shared ConfirmDialog. Beyond the inconsistency, the
 * native path had no way to report a FAILED delete — the mutation error was
 * swallowed and the card just sat there. These tests pin the migrated flow.
 */

vi.mock('~/components/wiki/maps/MapUploadModal', () => ({
  MapUploadModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="map-upload" /> : null,
}));

vi.mock('~/hooks/useMaps');
vi.mock('~/hooks/useCampaigns');
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'campaign-123' }),
}));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({ playerState: null }),
}));

const mockMaps = [
  {
    id: 'map-1',
    campaignId: 'campaign-123',
    name: 'Sunken Crypt',
    imageUrl: 'https://cdn.example/map.png',
    thumbnailUrl: null,
    width: 1000,
    height: 800,
    gridSize: 50,
    scale: 5,
    createdBy: 'user-1',
    createdAt: '',
    updatedAt: '',
  },
];

const deleteMutateAsync = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  deleteMutateAsync.mockResolvedValue({ success: true });

  vi.mocked(useCampaign).mockReturnValue({ campaign: { isGM: true } } as never);
  vi.mocked(useMapsList).mockReturnValue({
    data: mockMaps,
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(useActiveMap).mockReturnValue({ data: null } as never);
  vi.mocked(useMapsMutations).mockReturnValue({
    createMap: { mutate: vi.fn(), isPending: false },
    updateMapScale: { mutate: vi.fn(), isPending: false },
    updateMap: { mutate: vi.fn(), isPending: false },
    deleteMap: { mutate: vi.fn(), mutateAsync: deleteMutateAsync, isPending: false },
    setActiveMap: { mutate: vi.fn(), isPending: false },
  } as never);
});

async function openDeleteDialog() {
  const user = userEvent.setup();
  render(<MapsPanel onBack={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Map actions' }));
  await user.click(await screen.findByTestId('overflow-item-delete'));
  return user;
}

describe('MapsPanel delete flow', () => {
  it('confirms through the shared dialog, not window.confirm', async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal('confirm', nativeConfirm);
    try {
      await openDeleteDialog();

      const dialog = await screen.findByRole('alertdialog');
      // Scope to the dialog — the map name also appears on the card behind it.
      expect(within(dialog).getByText(/Sunken Crypt/)).toBeInTheDocument();
      // The native dialog is blocking and unstyled — it must not be used.
      expect(nativeConfirm).not.toHaveBeenCalled();
      // ...and nothing is deleted until the user confirms.
      expect(deleteMutateAsync).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('deletes on confirm', async () => {
    const user = await openDeleteDialog();
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('map-1'));
  });

  it('does not delete on cancel', async () => {
    const user = await openDeleteDialog();
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open and reports a failed delete', async () => {
    // The whole point of leaving window.confirm behind: a rejected delete used
    // to vanish silently, leaving the card on screen with no explanation.
    deleteMutateAsync.mockRejectedValue(new Error('network'));
    const user = await openDeleteDialog();
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Failed to delete map/i);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
