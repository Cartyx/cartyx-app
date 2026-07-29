import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioAssetDetail } from './AudioAssetDetail';
import type { AudioAssetData } from '~/types/audio';

const base: AudioAssetData = {
  id: 'a1',
  ownerId: 'u1',
  title: 'storm_loop_v3_FINAL',
  kind: 'ambience',
  environment: ['coast'],
  mood: ['tense'],
  intensity: 4,
  tags: ['storm', 'rain'],
  status: 'ready',
  durationMs: 125_000,
  durationSamples: 6_000_000,
  loudnessTargetLufs: -20,
  peaks: [0.1, 0.9, 0.4],
  renditions: {},
  lastError: null,
  permanentFailure: false,
  createdAt: '',
  updatedAt: '',
};

const meta: Meta<typeof AudioAssetDetail> = {
  title: 'Audio/AudioAssetDetail',
  component: AudioAssetDetail,
  tags: ['autodocs'],
  args: {
    onSave: () => {},
    onClose: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The primary case this component exists for: a bulk-uploaded asset with a
 * filename-derived title, waiting to be renamed.
 */
export const Ready: Story = {
  args: { asset: base },
};

/**
 * Edit stays reachable for non-ready assets (only Play is gated on `ready`
 * — see `AudioAssetRow`), so this modal must render sensibly for one too.
 */
export const Processing: Story = {
  args: {
    asset: { ...base, status: 'processing', durationMs: null, peaks: [] },
  },
};

export const Failed: Story = {
  args: {
    asset: {
      ...base,
      status: 'failed',
      lastError: 'Unsupported codec',
      durationMs: null,
      peaks: [],
    },
  },
};

export const NoFacetsSet: Story = {
  args: {
    asset: { ...base, environment: [], mood: [], intensity: null, tags: [] },
  },
};

export const Saving: Story = {
  args: { asset: base, saving: true },
};

export const WithError: Story = {
  args: { asset: base, error: 'Failed to save changes. Please try again.' },
};
