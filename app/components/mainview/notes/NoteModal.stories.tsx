import type { Meta, StoryObj } from '@storybook/react-vite';
import { NoteModal } from './NoteModal';
import { mockSessions } from '~/services/mocks/sessionsService';
import { WikiCardActionsStubProvider } from '~/components/wiki/shared/WikiCardActionsStubProvider';

const meta: Meta<typeof NoteModal> = {
  title: 'Components/MainView/Notes/NoteModal',
  component: NoteModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    // The modal header renders ShowOnTabletopButton, whose hook runs before its
    // own isGM early-return — so it throws without a provider regardless of role.
    (Story) => (
      <WikiCardActionsStubProvider>
        <Story />
      </WikiCardActionsStubProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CreateMode: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    campaignId: 'camp-1',
    sessions: [...mockSessions],
  },
};

export const CreateWithDefaultSession: Story = {
  args: {
    ...CreateMode.args,
    defaultSessionId: 'session-14',
  },
};

export const NoSessions: Story = {
  args: {
    ...CreateMode.args,
    sessions: [],
  },
};
