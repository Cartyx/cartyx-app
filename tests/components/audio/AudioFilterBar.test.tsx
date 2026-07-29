import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioFilterBar } from '~/components/audio/AudioFilterBar';
import type { AudioFilters } from '~/components/audio/AudioFilterBar';

/**
 * AudioFilterBar is fully controlled — it holds no internal state for the
 * fields it emits. If a test never feeds `onChange` back into `value`, a
 * controlled <input> snaps back to the stale prop after every keystroke, so
 * only the *last* keystroke would ever reach `onChange`. That would make an
 * assertion on accumulated text pass or fail based on React's controlled-
 * input mechanics rather than the component's logic. This harness applies
 * each `onChange` the way a real caller (AudioLibraryBrowser) would.
 */
function ControlledFilterBar({
  initial = {},
  onChange,
}: {
  initial?: AudioFilters;
  onChange: (next: AudioFilters) => void;
}) {
  const [value, setValue] = React.useState<AudioFilters>(initial);
  return (
    <AudioFilterBar
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('AudioFilterBar', () => {
  it('emits a kind filter when a kind chip is chosen', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'music' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'music' });
  });

  it('clears the kind when the active chip is clicked again', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{ kind: 'music' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'music' }));
    expect(onChange).toHaveBeenCalledWith({ kind: undefined });
  });

  it('marks only the active kind chip as pressed', () => {
    render(<AudioFilterBar value={{ kind: 'music' }} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'music' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ambience' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('emits the accumulated search text as the user types', async () => {
    const onChange = vi.fn();
    render(<ControlledFilterBar onChange={onChange} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'st');
    expect(onChange).toHaveBeenLastCalledWith({ search: 'st' });
  });

  it('clears the search filter when the box is emptied', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{ search: 'x' }} onChange={onChange} />);
    await userEvent.clear(screen.getByRole('searchbox', { name: /search/i }));
    expect(onChange).toHaveBeenLastCalledWith({ search: undefined });
  });

  it('toggles the needs-tagging filter on', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /needs tagging/i }));
    expect(onChange).toHaveBeenCalledWith({ needsTagging: true });
  });

  it('toggles the needs-tagging filter back off', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{ needsTagging: true }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /needs tagging/i }));
    expect(onChange).toHaveBeenCalledWith({ needsTagging: undefined });
  });

  it('toggles an environment facet on', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    expect(onChange).toHaveBeenLastCalledWith({ environment: ['forest'] });
  });

  it('toggles an environment facet back off', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{ environment: ['forest'] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    expect(onChange).toHaveBeenLastCalledWith({ environment: undefined });
  });

  it('toggles a mood facet on', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'tense' }));
    expect(onChange).toHaveBeenLastCalledWith({ mood: ['tense'] });
  });

  it('adds a typed tag to the filter on Enter', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: /add tag/i });
    await userEvent.type(input, 'storm{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ tags: ['storm'] });
  });

  it('removes a tag chip when its remove control is clicked', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{ tags: ['storm', 'rain'] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /remove tag storm/i }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: ['rain'] });
  });

  it('emits a minimum intensity as a number', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.type(screen.getByRole('spinbutton', { name: /minimum intensity/i }), '2');
    expect(onChange).toHaveBeenLastCalledWith({ intensityMin: 2 });
  });

  it('emits a maximum intensity as a number', async () => {
    const onChange = vi.fn();
    render(<AudioFilterBar value={{}} onChange={onChange} />);
    await userEvent.type(screen.getByRole('spinbutton', { name: /maximum intensity/i }), '4');
    expect(onChange).toHaveBeenLastCalledWith({ intensityMax: 4 });
  });
});
