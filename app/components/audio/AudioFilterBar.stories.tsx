import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioFilterBar } from './AudioFilterBar';
import type { AudioFilters } from './AudioFilterBar';

const meta: Meta<typeof AudioFilterBar> = {
  title: 'Audio/AudioFilterBar',
  component: AudioFilterBar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-3xl bg-[#0D1117]">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial }: { initial: AudioFilters }) {
  const [value, setValue] = useState<AudioFilters>(initial);
  return <AudioFilterBar value={value} onChange={setValue} />;
}

export const Empty: Story = {
  render: () => <Controlled initial={{}} />,
};

export const Filtered: Story = {
  render: () => (
    <Controlled
      initial={{
        kind: 'ambience',
        environment: ['coast'],
        mood: ['tense'],
        tags: ['storm'],
        search: 'storm',
        needsTagging: true,
        intensityMin: 2,
        intensityMax: 4,
      }}
    />
  ),
};
