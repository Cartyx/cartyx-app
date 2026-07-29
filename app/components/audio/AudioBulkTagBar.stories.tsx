import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioBulkTagBar } from './AudioBulkTagBar';

const meta: Meta<typeof AudioBulkTagBar> = {
  title: 'Audio/AudioBulkTagBar',
  component: AudioBulkTagBar,
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

export const WithSelection: Story = {
  args: { selectedCount: 12, onApply: () => {}, onClear: () => {} },
};

export const Hidden: Story = {
  args: { selectedCount: 0, onApply: () => {} },
};

export const WithoutClear: Story = {
  args: { selectedCount: 3, onApply: () => {} },
};
