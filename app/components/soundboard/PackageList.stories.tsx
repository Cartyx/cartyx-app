import type { Meta, StoryObj } from '@storybook/react-vite';
import { PackageList } from './PackageList';
import type { AudioPackageSummaryData } from '~/types/soundboard';

function makePackage(overrides: Partial<AudioPackageSummaryData> = {}): AudioPackageSummaryData {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Tavern Ambience',
    description: 'Crowd chatter, mugs clinking, a distant fiddle.',
    itemCount: 0,
    moodCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const meta: Meta<typeof PackageList> = {
  title: 'Soundboard/PackageList',
  component: PackageList,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A mix of owned and system packages — the shape `/audio/packages` renders
 * in practice. System rows carry the "System" badge and offer only Clone;
 * owned rows offer Edit and Delete.
 */
export const Mixed: Story = {
  args: {
    packages: [
      makePackage({
        id: 'sys1',
        ownerId: null,
        name: 'Storm Basics',
        description: 'Rain, distant thunder, wind gusts.',
        itemCount: 2,
        moodCount: 1,
      }),
      makePackage({ id: 'own1', ownerId: 'u1', name: 'My Tavern' }),
      makePackage({
        id: 'own2',
        ownerId: 'u1',
        name: 'Dungeon Depths',
        description: null,
      }),
    ],
    onEdit: () => {},
    onClone: () => {},
    onDelete: () => {},
  },
};

/** Only system packages are visible yet — every row offers Clone, none offer Edit. */
export const OnlySystemPackages: Story = {
  args: {
    packages: [
      makePackage({ id: 'sys1', ownerId: null, name: 'Storm Basics' }),
      makePackage({ id: 'sys2', ownerId: null, name: 'Tavern Basics' }),
    ],
    onClone: () => {},
  },
};

/** A clone in flight — that row's Clone item is disabled so it can't double-fire. */
export const CloningInProgress: Story = {
  args: {
    packages: [
      makePackage({ id: 'sys1', ownerId: null, name: 'Storm Basics' }),
      makePackage({ id: 'sys2', ownerId: null, name: 'Tavern Basics' }),
    ],
    onClone: () => {},
    cloningId: 'sys1',
  },
};

export const Empty: Story = {
  args: { packages: [] },
};
