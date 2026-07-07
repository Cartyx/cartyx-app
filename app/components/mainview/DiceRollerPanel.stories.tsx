import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DiceRollerPanel } from './DiceRollerPanel';

const meta: Meta<typeof DiceRollerPanel> = {
  title: 'Components/DiceRollerPanel',
  component: DiceRollerPanel,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="h-[520px] w-[340px] border border-white/[0.07]">
      <DiceRollerPanel />
    </div>
  ),
};
