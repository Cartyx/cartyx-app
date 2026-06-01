import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabletopView } from './TabletopView';

const meta: Meta<typeof TabletopView> = {
  title: 'Components/MainView/TabletopView',
  component: TabletopView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    campaignId: 'story-campaign-1',
    isGM: true,
    getToken: () => Promise.resolve('story-token'),
    sessionId: null,
  },
  decorators: [
    (Story) => (
      <div className="h-screen bg-[#0D1117]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AsPlayer: Story = {
  args: {
    isGM: false,
  },
};
