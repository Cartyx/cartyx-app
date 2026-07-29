import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const uploadAudioFile = vi.fn();
vi.mock('~/utils/uploadAudio', () => ({
  uploadAudioFile: (...a: unknown[]) => uploadAudioFile(...a),
}));

import { AudioUploadDropzone } from '~/components/audio/AudioUploadDropzone';

function makeFile(name: string, bytes = 1) {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
}

describe('AudioUploadDropzone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadAudioFile.mockResolvedValue({ assetId: 'a1' });
  });

  it('uploads every selected file, each with the batch default kind', async () => {
    const fileA = makeFile('a.wav');
    const fileB = makeFile('b.wav');
    render(<AudioUploadDropzone />);
    const input = screen.getByLabelText(/choose audio files/i);
    await userEvent.upload(input, [fileA, fileB]);
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(2));

    // Assert both the meta AND which file went with which call — a loop
    // that uploaded fileA twice (or fileB twice) would still satisfy a
    // bare "called twice with kind ambience" assertion.
    expect(uploadAudioFile.mock.calls[0][0]).toBe(fileA);
    expect(uploadAudioFile.mock.calls[0][1]).toMatchObject({ kind: 'ambience' });
    expect(uploadAudioFile.mock.calls[1][0]).toBe(fileB);
    expect(uploadAudioFile.mock.calls[1][1]).toMatchObject({ kind: 'ambience' });
  });

  it('uploads with the kind selected before the drop, not the hardcoded default', async () => {
    const file = makeFile('c.wav');
    render(<AudioUploadDropzone />);
    await userEvent.selectOptions(screen.getByLabelText(/kind for this batch/i), 'music');
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [file]);
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(1));
    expect(uploadAudioFile.mock.calls[0][1]).toMatchObject({ kind: 'music' });
  });

  it('reports a per-file failure without aborting the batch, and the next file still succeeds in the UI', async () => {
    uploadAudioFile
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ assetId: 'a2' });

    render(<AudioUploadDropzone />);
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [
      makeFile('bad.wav'),
      makeFile('good.wav'),
    ]);

    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    expect(uploadAudioFile).toHaveBeenCalledTimes(2);

    // The second file's row must reflect success in the UI, not merely
    // that the mock was invoked a second time.
    const goodRow = screen.getByText('good.wav').closest('li');
    expect(goodRow).not.toBeNull();
    await waitFor(() => expect(goodRow).toHaveTextContent(/done/i));
  });

  it('runs uploads sequentially, never starting the next file before the previous one settles', async () => {
    let resolveFirst!: (v: { assetId: string }) => void;
    const firstUpload = new Promise<{ assetId: string }>((resolve) => {
      resolveFirst = resolve;
    });
    uploadAudioFile.mockImplementationOnce(() => firstUpload);
    uploadAudioFile.mockResolvedValueOnce({ assetId: 'a2' });

    render(<AudioUploadDropzone />);
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [
      makeFile('first.wav'),
      makeFile('second.wav'),
    ]);

    // The first upload is in flight and unresolved — the second file must
    // not have been attempted yet. If uploads ran concurrently, both calls
    // would already be present here.
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(1));
    expect(uploadAudioFile).toHaveBeenCalledTimes(1);

    resolveFirst({ assetId: 'a1' });
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(2));
  });

  it('rejects an oversize file client-side without ever calling uploadAudioFile', async () => {
    const oversize = makeFile('huge.wav', 51 * 1024 * 1024);
    const okFile = makeFile('ok.wav');

    render(<AudioUploadDropzone />);
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [oversize, okFile]);

    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(1));
    // Only the ok file reached the upload call — the oversize file's row
    // shows an error without ever going through uploadAudioFile.
    expect(uploadAudioFile.mock.calls[0][0]).toBe(okFile);
    const hugeRow = screen.getByText('huge.wav').closest('li');
    expect(hugeRow).toHaveTextContent(/50\s?MB|exceeds/i);
  });

  it('calls onUploaded exactly once after the whole batch settles', async () => {
    const onUploaded = vi.fn();
    uploadAudioFile
      .mockResolvedValueOnce({ assetId: 'a1' })
      .mockRejectedValueOnce(new Error('boom'));

    render(<AudioUploadDropzone onUploaded={onUploaded} />);
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [
      makeFile('one.wav'),
      makeFile('two.wav'),
    ]);

    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('accepts files dropped onto the zone, not just chosen via the input', async () => {
    const dropped = makeFile('dropped.wav');
    render(<AudioUploadDropzone />);
    const zone = screen.getByTestId('audio-upload-dropzone');

    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });

    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(1));
    expect(uploadAudioFile.mock.calls[0][0]).toBe(dropped);
    expect(screen.getByText('dropped.wav')).toBeInTheDocument();
  });

  it('exposes the per-file status list as a live region so assistive tech hears status changes', async () => {
    render(<AudioUploadDropzone />);
    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [makeFile('a.wav')]);
    await waitFor(() => expect(screen.getByRole('list')).toBeInTheDocument());
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite');
  });

  it('refuses a second batch dropped while the first is still uploading, rather than interleaving them', async () => {
    let resolveFirst!: (v: { assetId: string }) => void;
    const firstUpload = new Promise<{ assetId: string }>((resolve) => {
      resolveFirst = resolve;
    });
    uploadAudioFile.mockImplementationOnce(() => firstUpload);

    render(<AudioUploadDropzone />);
    const zone = screen.getByTestId('audio-upload-dropzone');
    const fileA = makeFile('batch1.wav');
    const fileB = makeFile('batch2.wav');

    await userEvent.upload(screen.getByLabelText(/choose audio files/i), [fileA]);
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(1));

    // Batch 1's upload is still unresolved. Attempt a second batch via a
    // drop while it's in flight.
    fireEvent.drop(zone, { dataTransfer: { files: [fileB] } });

    // Let any (incorrect) async work from the drop run, then assert the
    // second batch never reached uploadAudioFile and never got a row —
    // it was refused outright, not queued, and definitely not interleaved
    // with batch 1's still-pending loop.
    await Promise.resolve();
    await Promise.resolve();
    expect(uploadAudioFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('batch2.wav')).not.toBeInTheDocument();

    // The disabled input reflects the refusal to the user, not just a
    // silently dropped event.
    expect(screen.getByLabelText(/choose audio files/i)).toBeDisabled();

    resolveFirst({ assetId: 'a1' });
    const batch1Row = screen.getByText('batch1.wav').closest('li');
    await waitFor(() => expect(batch1Row).toHaveTextContent(/done/i));

    // Batch 1's own completion must land on its own row, uncorrupted by
    // the refused second batch.
    expect(uploadAudioFile).toHaveBeenCalledTimes(1);

    // Once batch 1 has settled, the zone accepts a new batch again.
    expect(screen.getByLabelText(/choose audio files/i)).not.toBeDisabled();
    fireEvent.drop(zone, { dataTransfer: { files: [fileB] } });
    await waitFor(() => expect(uploadAudioFile).toHaveBeenCalledTimes(2));
    expect(uploadAudioFile.mock.calls[1][0]).toBe(fileB);
  });

  it('keeps the drag-active highlight while the pointer passes over a child element inside the zone', () => {
    render(<AudioUploadDropzone />);
    const zone = screen.getByTestId('audio-upload-dropzone');
    const child = screen.getByText(/choose audio files/i);

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone).toHaveClass('border-blue-500');

    // A real drag that moves from the zone's own box onto a child inside
    // it fires dragenter on the child (which bubbles to the zone too) and
    // dragleave on the zone. Without depth counting, that dragleave would
    // incorrectly clear the highlight even though the pointer never left
    // the zone.
    fireEvent.dragEnter(child, { dataTransfer: { types: ['Files'] } });
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone).toHaveClass('border-blue-500');

    // Actually leaving: dragleave on the child bubbles to the zone and
    // drops the depth counter to zero, clearing the highlight.
    fireEvent.dragLeave(child, { dataTransfer: { types: ['Files'] } });
    expect(zone).not.toHaveClass('border-blue-500');
  });
});
