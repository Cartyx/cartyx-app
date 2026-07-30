import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoodEditor } from '~/components/soundboard/MoodEditor';
import { MAX_PACKAGE_MOODS } from '~/types/soundboard';
import type { MoodData, PackageItemData } from '~/types/soundboard';

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

function mkMood(overrides: Partial<MoodData> = {}): MoodData {
  return { id: 'm1', name: 'Overhead', states: [], ...overrides };
}

const noop = () => {};

describe('MoodEditor', () => {
  // Load-bearing test 1: no override at all — the row shows the ITEM's own
  // value and carries no marker. If this fails, the marker is showing when
  // it shouldn't.
  it('renders the item value with no marker when the mood has no override for it', () => {
    const item = mkItem({ volume: 0.7 });
    const moods = [mkMood({ states: [] })];

    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={noop} />);

    const slider = screen.getByRole('slider', { name: /volume for rain in this mood/i });
    expect(slider).toHaveValue('0.7');
    expect(screen.queryByTestId('override-marker-volume-i1')).not.toBeInTheDocument();
  });

  // Load-bearing test 2: an override to a DIFFERENT value renders the new
  // value AND the marker. Different from the item's 0.7 so the rendered
  // value alone proves the override took effect.
  it('renders the overridden value and the marker when the mood overrides a field', () => {
    const item = mkItem({ volume: 0.7 });
    const moods = [mkMood({ states: [{ itemId: 'i1', playing: true, volume: 0.3 }] })];

    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={noop} />);

    const slider = screen.getByRole('slider', { name: /volume for rain in this mood/i });
    expect(slider).toHaveValue('0.3');
    expect(screen.getByTestId('override-marker-volume-i1')).toBeInTheDocument();
  });

  // Load-bearing test 3, and THE load-bearing test per the brief: a mood
  // that overrides volume to EXACTLY the item's own value (0.7 == 0.7) must
  // STILL show the marker. This is the case a resolved-vs-item comparison
  // implementation cannot pass — only a check against the raw moodState
  // field's presence can. See the "teeth" section in the task report for the
  // mutation that proves this.
  it('shows the marker even when the override value equals the item value', () => {
    const item = mkItem({ volume: 0.7 });
    const moods = [mkMood({ states: [{ itemId: 'i1', playing: true, volume: 0.7 }] })];

    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={noop} />);

    const slider = screen.getByRole('slider', { name: /volume for rain in this mood/i });
    expect(slider).toHaveValue('0.7');
    expect(screen.getByTestId('override-marker-volume-i1')).toBeInTheDocument();
  });

  // Load-bearing test 4: clearing an override must produce `undefined` in
  // the stored state — not the item's current value, and not 0. Asserted on
  // the emitted data directly, not just on what re-renders, per the brief's
  // warning that a clear-to-item's-value bug renders identically today and
  // only diverges once the item's own value later changes.
  it('clearing an override sets the field to undefined in the emitted mood, not the item value', async () => {
    const user = userEvent.setup();
    const onMoodsChange = vi.fn();
    const item = mkItem({ volume: 0.7 });
    const moods = [mkMood({ states: [{ itemId: 'i1', playing: true, volume: 0.3 }] })];

    const { rerender } = render(
      <MoodEditor items={[item]} moods={moods} onMoodsChange={onMoodsChange} />
    );

    await user.click(screen.getByRole('button', { name: /clear volume override for rain/i }));

    expect(onMoodsChange).toHaveBeenCalledTimes(1);
    const next = onMoodsChange.mock.calls[0][0] as MoodData[];
    const state = next[0].states.find((s) => s.itemId === 'i1');
    expect(state?.volume).toBeUndefined();
    // Not merely "falsy" — must not have silently become the item's 0.7 or a
    // bare 0 either. `'volume' in state` also fails if a bug spreads the
    // item's value in rather than clearing, since that would set a *defined*
    // number, not `undefined`.
    expect(state?.volume).not.toBe(0.7);
    expect(state?.volume).not.toBe(0);

    // Feed the emitted (cleared) moods back in as props — this is the
    // controlled-component contract every other soundboard editor uses — and
    // confirm the rendered value falls back to the item's own value with the
    // marker gone.
    rerender(<MoodEditor items={[item]} moods={next} onMoodsChange={onMoodsChange} />);
    const slider = screen.getByRole('slider', { name: /volume for rain in this mood/i });
    expect(slider).toHaveValue('0.7');
    expect(screen.queryByTestId('override-marker-volume-i1')).not.toBeInTheDocument();
  });

  it('setting an override calls onMoodsChange with the new value on the right item, preserving other fields', () => {
    const onMoodsChange = vi.fn();
    const item = mkItem({ id: 'i1', volume: 0.7 });
    const moods = [mkMood({ states: [{ itemId: 'i1', playing: true, fadeSeconds: 5 }] })];

    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={onMoodsChange} />);

    const slider = screen.getByRole('slider', { name: /volume for rain in this mood/i });
    fireEvent.change(slider, { target: { value: '0.9' } });

    expect(onMoodsChange).toHaveBeenCalledTimes(1);
    const next = onMoodsChange.mock.calls[0][0] as MoodData[];
    const state = next[0].states.find((s) => s.itemId === 'i1');
    expect(state?.volume).toBe(0.9);
    expect(state?.playing).toBe(true);
    expect(state?.fadeSeconds).toBe(5);
  });

  it('resolves to not-playing with no marker for an item the mood does not mention at all', () => {
    const item = mkItem({ id: 'i2', label: 'Thunder', volume: 1 });
    const moods = [mkMood({ states: [] })];

    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={noop} />);

    const checkbox = screen.getByRole('checkbox', { name: /playing thunder in this mood/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByTestId('override-marker-volume-i2')).not.toBeInTheDocument();
  });

  it('toggling playing upserts a state entry for an item with no prior state', () => {
    const onMoodsChange = vi.fn();
    const item = mkItem({ id: 'i2', label: 'Thunder' });
    const moods = [mkMood({ states: [] })];

    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={onMoodsChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /playing thunder in this mood/i }));

    expect(onMoodsChange).toHaveBeenCalledTimes(1);
    const next = onMoodsChange.mock.calls[0][0] as MoodData[];
    expect(next[0].states).toEqual([{ itemId: 'i2', playing: true }]);
  });

  it('disables adding a mood at MAX_PACKAGE_MOODS and shows the cap message', () => {
    const moods = Array.from({ length: MAX_PACKAGE_MOODS }, (_, i) =>
      mkMood({ id: `m${i}`, name: `Mood ${i}` })
    );
    render(<MoodEditor items={[]} moods={moods} onMoodsChange={noop} />);

    expect(screen.getByRole('button', { name: /add mood/i })).toBeDisabled();
    expect(screen.getByText(/package is full/i)).toBeInTheDocument();
  });

  it('does not show the cap message one mood below the cap', () => {
    const moods = Array.from({ length: MAX_PACKAGE_MOODS - 1 }, (_, i) =>
      mkMood({ id: `m${i}`, name: `Mood ${i}` })
    );
    render(<MoodEditor items={[]} moods={moods} onMoodsChange={noop} />);

    expect(screen.getByRole('button', { name: /add mood/i })).not.toBeDisabled();
    expect(screen.queryByText(/package is full/i)).not.toBeInTheDocument();
  });

  it('adding a mood mints a new mood and selects it', async () => {
    const user = userEvent.setup();
    const onMoodsChange = vi.fn();
    render(<MoodEditor items={[]} moods={[]} onMoodsChange={onMoodsChange} />);

    await user.click(screen.getByRole('button', { name: /add mood/i }));

    expect(onMoodsChange).toHaveBeenCalledTimes(1);
    const next = onMoodsChange.mock.calls[0][0] as MoodData[];
    expect(next).toHaveLength(1);
    expect(next[0].id).toBeTruthy();
    expect(next[0].states).toEqual([]);
  });

  it('removing a mood emits the moods array without it', async () => {
    const user = userEvent.setup();
    const onMoodsChange = vi.fn();
    const moods = [mkMood({ id: 'm1', name: 'Overhead' }), mkMood({ id: 'm2', name: 'Combat' })];
    render(<MoodEditor items={[]} moods={moods} onMoodsChange={onMoodsChange} />);

    await user.click(screen.getByRole('button', { name: /remove mood overhead/i }));

    expect(onMoodsChange).toHaveBeenCalledTimes(1);
    const next = onMoodsChange.mock.calls[0][0] as MoodData[];
    expect(next.map((m) => m.id)).toEqual(['m2']);
  });

  it('renaming the selected mood emits the updated name', () => {
    const onMoodsChange = vi.fn();
    const moods = [mkMood({ id: 'm1', name: 'Overhead' })];
    render(<MoodEditor items={[]} moods={moods} onMoodsChange={onMoodsChange} />);

    const input = screen.getByRole('textbox', { name: /mood name/i });
    fireEvent.change(input, { target: { value: 'Combat' } });

    expect(onMoodsChange).toHaveBeenCalledTimes(1);
    const next = onMoodsChange.mock.calls[0][0] as MoodData[];
    expect(next[0].name).toBe('Combat');
  });

  it('read-only mode hides mood mutation controls and disables state controls', () => {
    const item = mkItem();
    const moods = [mkMood({ states: [{ itemId: 'i1', playing: true, volume: 0.3 }] })];
    render(<MoodEditor items={[item]} moods={moods} onMoodsChange={noop} readOnly />);

    expect(screen.queryByRole('button', { name: /add mood/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove mood overhead/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /mood name/i })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /volume for rain in this mood/i })).toBeDisabled();
    // Marker still shows (read-only means no editing, not no display), but
    // the clear button is gone since it's a mutation control.
    expect(screen.getByTestId('override-marker-volume-i1')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /clear volume override for rain/i })
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when the package has no moods yet', () => {
    render(<MoodEditor items={[]} moods={[]} onMoodsChange={noop} />);
    expect(screen.getByText(/no moods yet/i)).toBeInTheDocument();
  });
});
