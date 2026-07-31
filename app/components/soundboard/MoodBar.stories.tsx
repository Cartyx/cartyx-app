import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoodBar } from './MoodBar';
import type { MoodData } from '~/types/soundboard';

const moods: MoodData[] = [
  { id: 'm1', name: 'Overhead', states: [] },
  { id: 'm2', name: 'Storm Peak', states: [] },
  { id: 'm3', name: 'Combat', states: [] },
];

const meta: Meta<typeof MoodBar> = {
  title: 'Soundboard/MoodBar',
  component: MoodBar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl bg-[#080A12] p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(args: React.ComponentProps<typeof MoodBar>) {
  const [activeMoodId, setActiveMoodId] = useState(args.activeMoodId);
  return <MoodBar {...args} activeMoodId={activeMoodId} onSelectMood={setActiveMoodId} />;
}

export const NoMoodSelected: Story = {
  render: (args) => <Controlled {...args} />,
  args: { moods, activeMoodId: null },
};

export const MoodSelected: Story = {
  render: (args) => <Controlled {...args} />,
  args: { moods, activeMoodId: 'm2' },
};

export const NoMoodsInPackage: Story = {
  render: (args) => <Controlled {...args} />,
  args: { moods: [], activeMoodId: null },
};
