import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioAssetDetail } from '~/components/audio/AudioAssetDetail';
import type { AudioAssetData } from '~/types/audio';

const asset: AudioAssetData = {
  id: 'a1',
  ownerId: 'u1',
  title: 'storm_loop_v3_FINAL',
  kind: 'ambience',
  environment: ['coast'],
  mood: ['tense'],
  intensity: 4,
  tags: ['storm', 'rain'],
  status: 'ready',
  durationMs: 125_000,
  durationSamples: 6_000_000,
  loudnessTargetLufs: -20,
  peaks: [0.1, 0.9, 0.4],
  renditions: {},
  lastError: null,
  permanentFailure: false,
  retryable: false,
  createdAt: '',
  updatedAt: '',
};

/**
 * A real opener + conditional mount, exactly like `useFocusTrap.test.tsx`'s
 * harness. Needed to assert focus actually moves into the dialog on open and
 * returns to this button on close — rendering the modal in isolation proves
 * nothing about either.
 */
function Harness({
  open,
  onSave,
  onClose,
}: {
  open: boolean;
  onSave: (payload: unknown) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <button type="button">Opener</button>
      {open && <AudioAssetDetail asset={asset} onSave={onSave} onClose={onClose} />}
    </div>
  );
}

describe('AudioAssetDetail', () => {
  it('shows a background once-variant error while the main asset remains ready', () => {
    render(
      <AudioAssetDetail
        asset={{ ...asset, kind: 'music', onceLastError: 'Audio file is completely silent' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Audio file is completely silent');
    expect(screen.getByLabelText('Attach once-variant audio file')).toBeEnabled();
  });

  it('shows read-only duration and status context', () => {
    render(<AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('2:05')).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
  });

  it('shows lastError when the asset failed', () => {
    render(
      <AudioAssetDetail
        asset={{ ...asset, status: 'failed', lastError: 'bad codec' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/bad codec/i)).toBeInTheDocument();
  });

  it('moves focus into the dialog on open', () => {
    const { rerender } = render(<Harness open={false} onSave={vi.fn()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: 'Opener' }).focus();
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();

    rerender(<Harness open={true} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/title/i)).toHaveFocus();
  });

  it('returns focus to the opener when the modal closes', async () => {
    // Opens via a real click on "Opener" (not a manual .focus() call before
    // mount, as in the test above) so the true opener — the button the user
    // actually clicked — is what useFocusTrap captures.
    function StatefulHarness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Opener
          </button>
          {open && (
            <AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={() => setOpen(false)} />
          )}
        </div>
      );
    }
    render(<StatefulHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Opener' }));
    expect(screen.getByLabelText(/title/i)).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
  });

  it('saves an edited title with only the title field in the payload', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    const titleInput = screen.getByLabelText(/title/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Storm — Heavy');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ title: 'Storm — Heavy' });
  });

  it('does not save an empty title, and shows a validation error', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
  });

  it('does not save a whitespace-only title', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    const titleInput = screen.getByLabelText(/title/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, '   ');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves an edited kind with only the kind field in the payload', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/^kind$/i), 'music');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'music' });
  });

  it('adds an environment chip and saves the full resulting array', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ environment: ['coast', 'forest'] });
  });

  it('removes an environment chip and saves the resulting array', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'coast' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ environment: [] });
  });

  it('adds a mood chip and saves only the mood field', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'eerie' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ mood: ['tense', 'eerie'] });
  });

  it('marks the currently selected environment and mood chips as pressed', () => {
    render(<AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'coast' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'forest' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'tense' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes intensity and saves only the intensity field', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/intensity/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ intensity: 2 });
  });

  it('clears intensity to null', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/intensity/i), '');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ intensity: null });
  });

  it('edits tags via the comma-separated field and saves the parsed array', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    const tagsInput = screen.getByLabelText(/tags/i);
    await userEvent.clear(tagsInput);
    await userEvent.type(tagsInput, 'storm, coastal');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ tags: ['storm', 'coastal'] });
  });

  it('saves a tags edit that duplicates an existing tag, even though the set of unique values is unchanged', async () => {
    // Regression test: `asset.tags` is ['storm', 'rain']. Retyping the field
    // as 'storm, storm' is a different value (two of the same tag, not one
    // of each) but has the same *set* of unique tags as the original. A
    // same-set comparison would wrongly treat this as unchanged and drop
    // `tags` from the payload entirely, silently discarding the edit.
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    const tagsInput = screen.getByLabelText(/tags/i);
    await userEvent.clear(tagsInput);
    await userEvent.type(tagsInput, 'storm, storm');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ tags: ['storm', 'storm'] });
  });

  it('resets the form to a newly-passed asset instead of keeping a stale in-progress edit', () => {
    const otherAsset: AudioAssetData = {
      ...asset,
      id: 'a2',
      title: 'Cave Drips',
      kind: 'one-shot',
      environment: ['dungeon'],
      mood: ['eerie'],
      intensity: 1,
      tags: ['drip'],
    };
    const { rerender } = render(
      <AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={vi.fn()} />
    );
    // In-progress, unsaved edit to asset A's title.
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'unsaved edit' } });
    expect(screen.getByLabelText(/title/i)).toHaveValue('unsaved edit');

    rerender(<AudioAssetDetail asset={otherAsset} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText(/title/i)).toHaveValue('Cave Drips');
    expect(screen.getByLabelText(/^kind$/i)).toHaveValue('one-shot');
    expect(screen.getByLabelText(/tags/i)).toHaveValue('drip');
    expect(screen.getByRole('button', { name: 'dungeon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'eerie' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not resubmit a stale value for an untouched field after a same-id prop refresh (e.g. a poll)', async () => {
    // Task 19 polls the asset list every 4s while any asset is non-terminal,
    // so the `asset` prop can get a new object for the *same* id mid-edit —
    // e.g. someone else bulk-tagged this asset while the modal was open.
    // The user never touched tags here; saving must not resubmit the tags
    // value from when the modal opened (which is now stale) and clobber
    // that concurrent change.
    const onSave = vi.fn();
    const { rerender } = render(
      <AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />
    );
    const refreshedAsset: AudioAssetData = { ...asset, tags: ['storm', 'rain', 'thunder'] };
    rerender(<AudioAssetDetail asset={refreshedAsset} onSave={onSave} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledWith({ environment: ['coast', 'forest'] });
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ tags: expect.anything() }));
  });

  it('sends only the fields that actually changed', async () => {
    const onSave = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={vi.fn()} />);
    // Re-typing the tags field to the exact same values it already had
    // should not put `tags` in the payload.
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ environment: ['coast', 'forest'] });
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.anything() }));
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ tags: expect.anything() }));
    expect(onSave).not.toHaveBeenCalledWith(
      expect.objectContaining({ intensity: expect.anything() })
    );
  });

  it('calls onClose, not onSave, when Cancel is clicked', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/title/i), ' extra');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose, not onSave, when the close (X) button is clicked', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without calling onSave', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={onSave} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the dialog', async () => {
    const onClose = vi.fn();
    render(<AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the error prop', () => {
    render(
      <AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={vi.fn()} error="Save failed" />
    );
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('disables the save control while saving', () => {
    render(<AudioAssetDetail asset={asset} onSave={vi.fn()} onClose={vi.fn()} saving />);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});

/**
 * Task 18: the once-variant attach control. `asset` above is `kind:
 * 'ambience'`, so every test here supplies its own `kind: 'music'` fixture
 * — the control must not appear for any other kind, matching the design
 * doc's "Optional second set, `kind: 'music'` only".
 */
describe('AudioAssetDetail once-variant control', () => {
  const musicAsset: AudioAssetData = { ...asset, kind: 'music' };

  it('does not render when the caller omits onAttachOnceVariant, even for a music asset', () => {
    render(<AudioAssetDetail asset={musicAsset} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText(/attach once-variant/i)).not.toBeInTheDocument();
  });

  it('does not render for a non-music asset even when onAttachOnceVariant is supplied', () => {
    render(
      <AudioAssetDetail
        asset={asset}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/attach once-variant/i)).not.toBeInTheDocument();
  });

  it('fires onAttachOnceVariant with the picked file for a ready music asset', async () => {
    const onAttachOnceVariant = vi.fn();
    render(
      <AudioAssetDetail
        asset={musicAsset}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={onAttachOnceVariant}
      />
    );
    const input = screen.getByLabelText(/attach once-variant/i) as HTMLInputElement;
    expect(input).toBeEnabled();
    const file = new File(['ending'], 'ending.wav', { type: 'audio/wav' });
    await userEvent.upload(input, file);
    expect(onAttachOnceVariant).toHaveBeenCalledTimes(1);
    expect(onAttachOnceVariant).toHaveBeenCalledWith(file);
  });

  it('disables the control while the main asset has not finished processing', () => {
    render(
      <AudioAssetDetail
        asset={{ ...musicAsset, status: 'processing', durationMs: null, peaks: [] }}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/attach once-variant/i)).toBeDisabled();
  });

  it('disables the control while attachingOnceVariant', () => {
    render(
      <AudioAssetDetail
        asset={musicAsset}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={vi.fn()}
        attachingOnceVariant
      />
    );
    expect(screen.getByLabelText(/attach once-variant/i)).toBeDisabled();
    expect(screen.getByText(/uploading/i)).toBeInTheDocument();
  });

  it('shows the once-variant error when attaching fails', () => {
    render(
      <AudioAssetDetail
        asset={musicAsset}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={vi.fn()}
        onceVariantError="Unsupported audio type: video/mp4"
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported audio type: video/mp4');
  });

  it('indicates an already-attached once-variant instead of the generic hint', () => {
    render(
      <AudioAssetDetail
        asset={{
          ...musicAsset,
          onceRenditions: { opus: { key: 'k', url: 'https://cdn.test/once.opus', bytes: 1 } },
        }}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onAttachOnceVariant={vi.fn()}
      />
    );
    expect(screen.getByText(/is attached/i)).toBeInTheDocument();
  });
});
