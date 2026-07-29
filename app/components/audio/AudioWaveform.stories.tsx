import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioWaveform } from './AudioWaveform';

const meta: Meta<typeof AudioWaveform> = {
  title: 'Audio/AudioWaveform',
  component: AudioWaveform,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md p-6 bg-[#080A12] text-blue-500">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

const peaks = Array.from({ length: 200 }, (_, i) => Math.abs(Math.sin(i / 8)) * 0.9);

export const Default: Story = {
  args: { peaks },
};

export const Tall: Story = {
  args: { peaks, height: 56 },
};

export const Sparse: Story = {
  args: { peaks: [0.2, 0.8, 0.4, 0.9, 0.1, 0.6] },
};

/** No peaks yet (asset still uploading/processing) — a blank, decorative placeholder. */
export const Empty: Story = {
  args: { peaks: [] },
};
