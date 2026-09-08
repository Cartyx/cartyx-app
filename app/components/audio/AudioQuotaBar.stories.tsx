import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioQuotaBar } from './AudioQuotaBar';

const GIB = 1024 * 1024 * 1024;

const meta: Meta<typeof AudioQuotaBar> = {
  title: 'Audio/AudioQuotaBar',
  component: AudioQuotaBar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-lg bg-[#0D1117] p-4">
        <Story />
      </div>
    ),
  ],
  // Every arg required by AudioQuotaBarProps gets a default here — Task 5's
  // brief calls out (citing phase 2a's tasks 14/15/16) that a story relying
  // on `component`'s own defaultProps rather than explicit `args` can throw
  // on render the moment a required prop is missing. There are none of those
  // here, but the args below are still explicit for every story rather than
  // partial overrides of an implicit "loaded" baseline.
  args: {
    usageBytes: 512 * 1024 * 1024,
    assetCount: 12,
    limitBytes: 2 * GIB,
    error: null,
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {};

/**
 * `NEAR_LIMIT_RATIO` is 0.9 — this sits just past it (91%), one MB shy of
 * `Over`, so the two stories stay visually distinguishable from each other in
 * the Storybook grid rather than looking identical.
 */
export const NearLimit: Story = {
  args: {
    usageBytes: Math.round(2 * GIB * 0.91),
    assetCount: 40,
  },
};

/**
 * Exactly AT the limit, not past it — `quotaStatus`'s `>=` boundary mirrors
 * `assertUnderStorageQuota`'s server-side refusal (`usage.bytes >=
 * limitBytes`), so this is the smallest usage value the server would already
 * be refusing new uploads for.
 */
export const OverLimit: Story = {
  args: {
    usageBytes: 2 * GIB,
    assetCount: 57,
  },
};

export const Loading: Story = {
  args: {
    usageBytes: null,
    limitBytes: null,
  },
};

export const QueryFailed: Story = {
  args: {
    usageBytes: null,
    limitBytes: null,
    error: 'Failed to load storage usage.',
  },
};

export const EmptyLibrary: Story = {
  args: {
    usageBytes: 0,
    assetCount: 0,
  },
};
