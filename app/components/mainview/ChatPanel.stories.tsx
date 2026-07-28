import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage } from '~/hooks/useChatMessages';

// ChatPanel is fully controlled — every prop is required. These stories used to
// render it with NO args at all, which threw on `sessions.map`.
const sessions = [
  { id: 'session-14', name: 'The Sunken Crown', number: 14 },
  { id: 'session-13', name: 'Glassmere Market', number: 13 },
];

const message = (over: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'seq'>): ChatMessage => ({
  sessionId: 'session-14',
  campaignId: 'camp-1',
  channel: 'general',
  type: 'chat',
  authorId: 'u1',
  authorName: 'Vex',
  text: 'I check the door for traps.',
  timestamp: Date.parse('2026-03-21T20:00:00Z'),
  ...over,
});

const messages: ChatMessage[] = [
  message({ id: 'm1', seq: 1 }),
  message({ id: 'm2', seq: 2, authorId: 'gm', authorName: 'GM', text: 'Roll a Perception check.' }),
  message({ id: 'm3', seq: 3, authorId: 'u2', authorName: 'Brann', text: 'Natural 20!' }),
];

const meta: Meta<typeof ChatPanel> = {
  title: 'Components/MainView/ChatPanel',
  component: ChatPanel,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    messages,
    sessions,
    activeSessionId: 'session-14',
    saveError: null,
    onSendMessage: () => {},
    onSessionChange: () => {},
    onDismissError: () => {},
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen justify-end bg-[#080A12]">
        <div className="h-full w-80 border-l border-white/[0.07]">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { messages: [] },
};

export const WithSaveError: Story = {
  args: { saveError: 'Message failed to send.' },
};
