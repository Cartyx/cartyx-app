import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotesListWidget } from './NotesListWidget';
import { mockSessions } from '~/services/mocks/sessionsService';
import type { NoteListItem } from '~/types/note';

const mockNotes: NoteListItem[] = [
  {
    id: 'note-1',
    campaignId: 'camp-1',
    sessionId: 'session-14',
    createdBy: 'user-1',
    title: 'The Traitor Revealed',
    tags: ['betrayal', 'emberfall', 'plot-twist'],
    isPublic: true,
    canEdit: true,
    createdAt: '2026-03-21T20:00:00Z',
    updatedAt: '2026-03-21T22:15:00Z',
  },
  {
    id: 'note-2',
    campaignId: 'camp-1',
    sessionId: 'session-13',
    createdBy: 'user-1',
    title: 'Hidden Sanctum Map Notes',
    tags: ['chapel', 'map'],
    isPublic: false,
    canEdit: true,
    createdAt: '2026-03-14T19:00:00Z',
    updatedAt: '2026-03-15T10:30:00Z',
  },
  {
    id: 'note-3',
    campaignId: 'camp-1',
    sessionId: 'session-12',
    createdBy: 'user-2',
    title: 'Glassmere Market Raid — Witness Accounts',
    tags: ['glassmere', 'raiders', 'investigation'],
    isPublic: true,
    canEdit: false,
    createdAt: '2026-03-07T18:00:00Z',
    updatedAt: '2026-03-08T09:00:00Z',
  },
  {
    id: 'note-4',
    campaignId: 'camp-1',
    sessionId: 'session-11',
    createdBy: 'user-1',
    title: 'Barrow Knight Negotiation Tactics',
    tags: [],
    isPublic: false,
    canEdit: true,
    createdAt: '2026-02-28T20:00:00Z',
    updatedAt: '2026-02-28T23:00:00Z',
  },
];

const meta: Meta<typeof NotesListWidget> = {
  title: 'Components/MainView/Notes/NotesListWidget',
  component: NotesListWidget,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-sm h-[500px] flex flex-col bg-[#080A12]">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    notes: mockNotes,
    sessions: [...mockSessions],
    isLoading: false,
    error: null,
    onNoteClick: () => {},
  },
};

export const SingleNote: Story = {
  args: {
    ...Default.args,
    notes: [mockNotes[0]!],
  },
};

export const Empty: Story = {
  args: {
    ...Default.args,
    notes: [],
  },
};

export const Loading: Story = {
  args: {
    ...Default.args,
    notes: [],
    isLoading: true,
  },
};

export const Error: Story = {
  args: {
    ...Default.args,
    notes: [],
    error: 'Failed to load notes. Please try again.',
  },
};

export const AllPrivate: Story = {
  args: {
    ...Default.args,
    notes: mockNotes.map((n) => ({ ...n, isPublic: false })),
  },
};

export const NoTags: Story = {
  args: {
    ...Default.args,
    notes: mockNotes.map((n) => ({ ...n, tags: [] })),
  },
};
