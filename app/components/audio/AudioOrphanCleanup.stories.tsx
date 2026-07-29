import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioOrphanCleanup } from './AudioOrphanCleanup';

const meta: Meta<typeof AudioOrphanCleanup> = {
  title: 'Audio/AudioOrphanCleanup',
  component: AudioOrphanCleanup,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-3xl bg-[#0D1117] p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    result: null,
    scanning: false,
    deleting: false,
    error: null,
    lastDelete: null,
    onScan: () => {},
    onDelete: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeFirstScan: Story = {};

export const Scanning: Story = { args: { scanning: true } };

export const NothingToReclaim: Story = {
  args: {
    result: { orphans: [], scannedObjectCount: 12, truncated: false, r2Disabled: false },
  },
};

export const OrphansFound: Story = {
  args: {
    result: {
      orphans: [
        {
          key: 'uploads/audio/renditions/507f1f77bcf86cd799439011.opus',
          sizeBytes: 2_400_000,
          lastModified: '2026-07-01T10:00:00.000Z',
        },
        {
          key: 'uploads/audio/renditions/507f1f77bcf86cd799439011.m4a',
          sizeBytes: 2_900_000,
          lastModified: '2026-07-01T10:00:01.000Z',
        },
      ],
      scannedObjectCount: 12,
      truncated: false,
      r2Disabled: false,
    },
  },
};

/**
 * The signal the campaign image scanner never emitted: its listing capped out
 * and dropped `IsTruncated`, so an account past the cap saw a partial result
 * presented as a complete one.
 */
export const TruncatedScan: Story = {
  args: {
    result: {
      orphans: [
        {
          key: 'uploads/audio/renditions/507f1f77bcf86cd799439011.opus',
          sizeBytes: 2_400_000,
          lastModified: '2026-07-01T10:00:00.000Z',
        },
      ],
      scannedObjectCount: 500,
      truncated: true,
      r2Disabled: false,
    },
  },
};

export const StorageDisabled: Story = {
  args: {
    result: { orphans: [], scannedObjectCount: 0, truncated: false, r2Disabled: true },
  },
};

export const ScanFailed: Story = {
  args: { error: 'Failed to scan for orphaned files. Please try again.' },
};

export const AfterDelete: Story = {
  args: {
    result: { orphans: [], scannedObjectCount: 12, truncated: false, r2Disabled: false },
    lastDelete: { deleted: 2, failed: 1 },
  },
};
