import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MasterBar } from './MasterBar';

const meta: Meta<typeof MasterBar> = {
  title: 'Soundboard/MasterBar',
  component: MasterBar,
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

function Controlled(args: React.ComponentProps<typeof MasterBar>) {
  const [masterVolume, setMasterVolume] = useState(args.masterVolume);
  return <MasterBar {...args} masterVolume={masterVolume} onMasterVolumeChange={setMasterVolume} />;
}

export const NothingPlaying: Story = {
  render: (args) => <Controlled {...args} />,
  args: { masterVolume: 1, playingCount: 0 },
};

export const SeveralPlaying: Story = {
  render: (args) => <Controlled {...args} />,
  args: { masterVolume: 0.75, playingCount: 4 },
};
