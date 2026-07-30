import type { ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPad, sortItemsBySortIndex } from '~/components/soundboard/BoardPad';
import type { BoardPadProps } from '~/components/soundboard/BoardPad';
import type { AudioAssetData } from '~/types/audio';
import type { PackageItemData } from '~/types/soundboard';

function mkItem(overrides: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: '507f1f77bcf86cd799439011',
    label: 'Rain',
    volume: 0.7,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 0,
    ...overrides,
  };
}

function mkAsset(overrides: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id: '507f1f77bcf86cd799439011',
    ownerId: 'u1',
    title: 'Rain (asset title)',
    kind: 'ambience',
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 10_000,
    durationSamples: 480_000,
    loudnessTargetLufs: -20,
    peaks: [],
    renditions: { opus: { key: 'k', url: 'https://example.com/a.opus', bytes: 100 } },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const noop = () => {};

describe('BoardPad', () => {
  it('renders the item label (from the package, not the asset) and the volume', () => {
    const item = mkItem({ label: 'Rain' });
    const asset = mkAsset({ title: 'Something Else Entirely' });

    render(
      <BoardPad
        item={item}
        asset={asset}
        playing={false}
        volume={0.42}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    // The label shown is the ITEM's label, never the asset's title — this is
    // what makes a dangling reference (asset undefined) still recoverable.
    expect(screen.getByText('Rain')).toBeInTheDocument();
    expect(screen.queryByText('Something Else Entirely')).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /volume for rain/i })).toHaveValue('0.42');
  });

  it('falls back to a short asset-id label when the item has no label', () => {
    const item = mkItem({ label: undefined, assetId: '507f1f77bcf86cd799439abc' });
    render(
      <BoardPad
        item={item}
        asset={mkAsset({ id: '507f1f77bcf86cd799439abc' })}
        playing={false}
        volume={0.5}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByText('Asset 439abc')).toBeInTheDocument();
  });

  it('a ready, resolved asset renders an enabled play control and no reason', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'ready' })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).not.toBeDisabled();
    expect(screen.queryByTestId('pad-unavailable-reason')).not.toBeInTheDocument();
  });

  it('clicking play/stop calls onPlay/onStop with the item id', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <BoardPad
        item={mkItem({ id: 'i1' })}
        asset={mkAsset()}
        playing={false}
        volume={0.7}
        onPlay={onPlay}
        onStop={onStop}
        onVolumeChange={noop}
      />
    );

    await user.click(screen.getByRole('button', { name: /play rain/i }));
    expect(onPlay).toHaveBeenCalledWith('i1');
    expect(onStop).not.toHaveBeenCalled();

    rerender(
      <BoardPad
        item={mkItem({ id: 'i1' })}
        asset={mkAsset()}
        playing={true}
        volume={0.7}
        onPlay={onPlay}
        onStop={onStop}
        onVolumeChange={noop}
      />
    );
    await user.click(screen.getByRole('button', { name: /stop rain/i }));
    expect(onStop).toHaveBeenCalledWith('i1');
  });

  it('dragging the volume slider calls onVolumeChange with the item id and the new value', () => {
    const onVolumeChange = vi.fn();
    render(
      <BoardPad
        item={mkItem({ id: 'i1' })}
        asset={mkAsset()}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={onVolumeChange}
      />
    );
    const slider = screen.getByRole('slider', { name: /volume for rain/i });
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(onVolumeChange).toHaveBeenCalledWith('i1', 0.3);
  });

  // ---------------------------------------------------------------------
  // Unavailable states. Each cause below gets its OWN case and its OWN
  // distinct expected reason string — a shared fixture, or a component that
  // renders one generic "Unavailable" string for every cause, cannot pass
  // all of these (see the task report's teeth-proof).
  // ---------------------------------------------------------------------

  it('a pending asset is disabled and states the specific reason (still queued)', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'pending' })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
    expect(screen.getByTestId('pad-unavailable-reason')).toHaveTextContent(
      'Queued — waiting to process'
    );
  });

  it('a processing asset is disabled and states the specific reason (actively transcoding)', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'processing' })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
    expect(screen.getByTestId('pad-unavailable-reason')).toHaveTextContent('Processing…');
  });

  it('an uploading asset is disabled and states the specific reason', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'uploading' })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
    expect(screen.getByTestId('pad-unavailable-reason')).toHaveTextContent('Uploading…');
  });

  it('a failed asset is disabled and states the server error as the reason', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'failed', lastError: 'ffmpeg exited with code 1' })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
    expect(screen.getByTestId('pad-unavailable-reason')).toHaveTextContent(
      'ffmpeg exited with code 1'
    );
  });

  it('a failed asset with no recorded error still states a specific (non-generic) reason', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'failed', lastError: null })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByTestId('pad-unavailable-reason')).toHaveTextContent('Failed to process');
  });

  it('a rendition that failed to decode is disabled and states that specific reason, distinct from a missing/failed asset', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ status: 'ready' })}
        playing={false}
        volume={0.7}
        decodeFailed
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
    expect(screen.getByTestId('pad-unavailable-reason')).toHaveTextContent(
      'Failed to decode this rendition'
    );
  });

  // The brief's required test: a pad whose asset was deleted must not throw,
  // and — this is the load-bearing part — must still render something
  // identifiable (the item's own label) plus a reason, not go blank. A
  // component that renders nothing for a dangling reference is exactly as
  // useless to a GM mid-session as one that throws.
  it('an asset that no longer resolves (deleted) does not throw, renders the item label, and states a distinct reason', () => {
    expect(() =>
      render(
        <BoardPad
          item={mkItem({ label: 'Rain' })}
          asset={undefined}
          playing={false}
          volume={0.7}
          onPlay={noop}
          onStop={noop}
          onVolumeChange={noop}
        />
      )
    ).not.toThrow();

    expect(screen.getByText('Rain')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
    const reason = screen.getByTestId('pad-unavailable-reason');
    expect(reason).toHaveTextContent(/removed|no longer|missing/i);
  });

  it('every unavailable cause produces a mutually distinct reason string', () => {
    const causes: { name: string; props: Partial<React.ComponentProps<typeof BoardPad>> }[] = [
      { name: 'pending', props: { asset: mkAsset({ status: 'pending' }) } },
      { name: 'processing', props: { asset: mkAsset({ status: 'processing' }) } },
      { name: 'uploading', props: { asset: mkAsset({ status: 'uploading' }) } },
      {
        name: 'failed',
        props: { asset: mkAsset({ status: 'failed', lastError: 'boom' }) },
      },
      { name: 'decodeFailed', props: { asset: mkAsset({ status: 'ready' }), decodeFailed: true } },
      { name: 'missing', props: { asset: undefined } },
    ];

    const reasons = causes.map(({ props }) => {
      const { unmount } = render(
        <BoardPad
          item={mkItem()}
          asset={undefined}
          playing={false}
          volume={0.7}
          onPlay={noop}
          onStop={noop}
          onVolumeChange={noop}
          {...props}
        />
      );
      const text = screen.getByTestId('pad-unavailable-reason').textContent;
      unmount();
      return text;
    });

    expect(new Set(reasons).size).toBe(reasons.length);
  });

  // ---------------------------------------------------------------------
  // Task 22 / E2E finding: the single transport button serves as BOTH Play
  // and Stop. Gating it on `disabled={unavailable}` alone means a pad that
  // the board reports as `playing: true` (a dangling reference or a decode
  // failure discovered mid-playback) can never be stopped from the pad
  // itself — only Master Bar's Stop All can clear it, which is the wrong
  // failure mode mid-session. Both halves are asserted here, in the same
  // describe block, so a fix that also re-enables Play for an unavailable,
  // NOT-playing pad cannot pass silently (see the task report's teeth-proof:
  // reverting to `disabled={unavailable}` makes exactly the first test below
  // fail, not the second).
  // ---------------------------------------------------------------------

  it('an unavailable pad that is currently playing still exposes a working Stop control', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <BoardPad
        item={mkItem({ label: 'Rain' })}
        asset={undefined}
        playing={true}
        volume={0.7}
        onPlay={noop}
        onStop={onStop}
        onVolumeChange={noop}
      />
    );

    const button = screen.getByRole('button', { name: /stop rain/i });
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onStop).toHaveBeenCalledWith('i1');
    // Still shows the unavailable reason — Stop being reachable doesn't mean
    // the pad is pretending to be fine.
    expect(screen.getByTestId('pad-unavailable-reason')).toBeInTheDocument();
  });

  it('an unavailable pad that is NOT playing keeps Play disabled', () => {
    render(
      <BoardPad
        item={mkItem({ label: 'Rain' })}
        asset={undefined}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.getByRole('button', { name: /play rain/i })).toBeDisabled();
  });

  // ---------------------------------------------------------------------
  // The ∞/1× once-variant control.
  // ---------------------------------------------------------------------

  it('does not render the once-variant control when the asset has no onceRenditions', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ onceRenditions: undefined })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.queryByRole('button', { name: /switch rain to/i })).not.toBeInTheDocument();
  });

  /**
   * Task 18 review minor fix: `undefined` above is a real type-level
   * possibility (the field is optional), but it is no longer what
   * `serializeAudioAsset` actually sends — every served asset now has
   * `onceRenditions: {}` when nothing is attached (mirroring `renditions`'s
   * existing default). Nothing asserted that shape before; this does.
   */
  it('does not render the once-variant control when onceRenditions is {} (the real server shape)', () => {
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({ onceRenditions: {} })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    expect(screen.queryByRole('button', { name: /switch rain to/i })).not.toBeInTheDocument();
  });

  it('renders the once-variant control when the asset has an onceRenditions rendition, and toggling flips it', async () => {
    const user = userEvent.setup();
    render(
      <BoardPad
        item={mkItem()}
        asset={mkAsset({
          onceRenditions: { opus: { key: 'k', url: 'https://example.com/a.once.opus', bytes: 1 } },
        })}
        playing={false}
        volume={0.7}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );
    const toggle = screen.getByRole('button', { name: /switch rain to play once/i });
    expect(toggle).toHaveTextContent('∞');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /switch rain to loop/i })).toHaveTextContent('1×');
  });

  // ---------------------------------------------------------------------
  // Memoization: phase 1 found `useDeleteConfirm` returning a fresh closure
  // per render silently defeating a memo (see `AudioAssetRow`'s own doc
  // comment for the identical caller contract). `BoardPad` is wrapped in
  // `memo()` for the same reason `AudioAssetRow` is: a board can render up
  // to `MAX_PACKAGE_ITEMS` (64) pads, and a single volume drag re-renders
  // the whole list via `useReducer`.
  //
  // What this test asserts, and what it deliberately does NOT: it confirms
  // `BoardPad` is wrapped with `memo()` using the DEFAULT (shallow) prop
  // comparator — not a custom `areEqual` that could silently mask real
  // changes, and not "no memo at all" (the easy mistake to make by
  // forgetting to wrap the export). It does NOT attempt to prove via a
  // render-count spy that a bail-out actually skips work: a Profiler-based
  // version of that test was tried first and found to be a false signal —
  // see the task report's "Memo verification" section for the two-probe
  // repro showing `Profiler.onRender` fires on EVERY commit that reaches
  // its subtree position (even a trivially memoized child with 100% stable
  // props across an unrelated ancestor re-render), so a call-count
  // assertion there would pass or fail independent of whether `BoardPad`
  // actually bailed out. Given the shallow comparator is confirmed here,
  // the bail-out itself is React's own tested contract, not this codebase's
  // to reprove.
  // ---------------------------------------------------------------------

  it('is wrapped in memo with the default (shallow) comparator, not a custom one that could mask real prop changes', () => {
    // `MemoExoticComponent`'s public type doesn't declare `compare`, but
    // React always sets it on the object it returns from `memo()` (`null`/
    // `undefined` unless a second `areEqual` argument was passed) — read via
    // an unknown-shaped cast rather than `any` to keep this the one
    // deliberately-loose spot instead of a silently-untyped test file.
    const memoComponent = BoardPad as unknown as { $$typeof: symbol; compare: unknown };
    expect(memoComponent.$$typeof).toBe(Symbol.for('react.memo'));
    expect(memoComponent.compare == null).toBe(true);
  });

  // The structural test above proves the wrapper EXISTS; it does not prove
  // the memo actually BAILS OUT on a re-render. This one does, by spying on
  // `BoardPad`'s inner render function (the `.type` property `memo()` stores
  // on the object it returns — the function React actually invokes when it
  // decides a re-render is needed) and counting calls across a re-render
  // with shallow-equal props. If the memo bails out, the spy is called once;
  // if a prop reference is unstable (the `useDeleteConfirm` failure mode the
  // brief names), it's called twice. See the task report's "Memo
  // verification" section for why the earlier `Profiler`-based attempt at
  // this same proof was abandoned as a false signal, and why this technique
  // is the correct replacement.
  it('does not call the wrapped render function again on a re-render with shallow-equal props (memo bails out)', () => {
    const memoComponent = BoardPad as unknown as {
      type: (props: BoardPadProps) => ReactElement;
    };
    const originalType = memoComponent.type;
    const renderSpy = vi.fn(originalType);
    memoComponent.type = renderSpy;

    try {
      const item = mkItem();
      const asset = mkAsset();
      const onPlay = () => {};
      const onStop = () => {};
      const onVolumeChange = () => {};
      const props: BoardPadProps = {
        item,
        asset,
        playing: false,
        volume: 0.7,
        onPlay,
        onStop,
        onVolumeChange,
      };

      const { rerender } = render(<BoardPad {...props} />);
      expect(renderSpy).toHaveBeenCalledTimes(1);

      // Same references for every prop — a correctly memoized component
      // must bail out here, not call its render function a second time.
      rerender(<BoardPad {...props} />);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      // Restore, whether the assertions above passed or threw — a failure
      // here must not leak a spied `.type` into every other test in this
      // file (each of which renders the same imported `BoardPad`).
      memoComponent.type = originalType;
    }
  });
});

describe('sortItemsBySortIndex', () => {
  it("sorts by sortIndex, not array order — Task 9's resolveAllItems preserves array order, so whoever renders the pad list must sort here", () => {
    const items = [
      mkItem({ id: 'c', sortIndex: 2 }),
      mkItem({ id: 'a', sortIndex: 0 }),
      mkItem({ id: 'b', sortIndex: 1 }),
    ];
    expect(sortItemsBySortIndex(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const items = [mkItem({ id: 'b', sortIndex: 1 }), mkItem({ id: 'a', sortIndex: 0 })];
    const original = [...items];
    sortItemsBySortIndex(items);
    expect(items).toEqual(original);
  });
});
