import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoodBar } from '~/components/soundboard/MoodBar';
import type { MoodData } from '~/types/soundboard';

const moods: MoodData[] = [
  { id: 'm1', name: 'Overhead', states: [] },
  { id: 'm2', name: 'Storm', states: [] },
];

describe('MoodBar', () => {
  it('renders one button per mood', () => {
    render(<MoodBar moods={moods} activeMoodId={null} onSelectMood={vi.fn()} />);
    expect(screen.getByRole('button', { name: /set mood to overhead/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set mood to storm/i })).toBeInTheDocument();
  });

  it('marks the active mood pressed and leaves the rest unpressed', () => {
    render(<MoodBar moods={moods} activeMoodId="m2" onSelectMood={vi.fn()} />);
    expect(screen.getByRole('button', { name: /set mood to overhead/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: /set mood to storm/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('no mood active when activeMoodId is null: nothing is pressed', () => {
    render(<MoodBar moods={moods} activeMoodId={null} onSelectMood={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('clicking a mood calls onSelectMood with that mood id, one click, one call', async () => {
    const user = userEvent.setup();
    const onSelectMood = vi.fn();
    render(<MoodBar moods={moods} activeMoodId={null} onSelectMood={onSelectMood} />);

    await user.click(screen.getByRole('button', { name: /set mood to storm/i }));

    expect(onSelectMood).toHaveBeenCalledTimes(1);
    expect(onSelectMood).toHaveBeenCalledWith('m2');
  });

  it('renders an explanatory placeholder, not an empty bar, when the package has no moods', () => {
    render(<MoodBar moods={[]} activeMoodId={null} onSelectMood={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/no moods yet/i)).toBeInTheDocument();
  });
});
