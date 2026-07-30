import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BoardPad } from './BoardPad';
import type { AudioAssetData } from '~/types/audio';
import type { PackageItemData } from '~/types/soundboard';

function mkItem(overrides: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: '507f1f77bcf86cd799439011',
    label: 'Rain',
    volume: 0.7,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 0,
    ...overrides,
  };
}

function mkAsset(overrides: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id: '507f1f77bcf86cd799439011',
    ownerId: 'u1',
    title: 'Rain (library title)',
    kind: 'ambience',
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 45_000,
    durationSamples: 2_160_000,
    loudnessTargetLufs: -20,
    peaks: [],
    renditions: { opus: { key: 'k', url: 'https://example.com/a.opus', bytes: 100 } },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const meta: Meta<typeof BoardPad> = {
  title: 'Soundboard/BoardPad',
  component: BoardPad,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-64 bg-[#080A12] p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Fully controlled, like every other soundboard board/editor component — `playing`/`volume` are local state so the pad is interactive in the Storybook canvas. */
function Controlled(args: React.ComponentProps<typeof BoardPad>) {
  const [playing, setPlaying] = useState(args.playing);
  const [volume, setVolume] = useState(args.volume);
  return (
    <BoardPad
      {...args}
      playing={playing}
      volume={volume}
      onPlay={() => setPlaying(true)}
      onStop={() => setPlaying(false)}
      onVolumeChange={(_id, v) => setVolume(v)}
    />
  );
}

export const Idle: Story = {
  render: (args) => <Controlled {...args} />,
  args: { item: mkItem(), asset: mkAsset(), playing: false, volume: 0.7 },
};

export const Playing: Story = {
  render: (args) => <Controlled {...args} />,
  args: { item: mkItem(), asset: mkAsset(), playing: true, volume: 0.7 },
};

export const WithOnceVariant: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    item: mkItem({ label: 'Victory Fanfare' }),
    asset: mkAsset({
      title: 'Victory Fanfare',
      kind: 'music',
      onceRenditions: { opus: { key: 'k', url: 'https://example.com/a.once.opus', bytes: 1 } },
    }),
    playing: false,
    volume: 0.8,
  },
};

/** Still transcoding — one of three `AudioAssetStatus` values that all share the "still processing" cause but each get their own exact wording (see `PendingUploading`/`PendingProcessing`). */
export const PendingQueued: Story = {
  render: (args) => <Controlled {...args} />,
  args: { item: mkItem(), asset: mkAsset({ status: 'pending' }), playing: false, volume: 0.7 },
};

export const PendingUploading: Story = {
  render: (args) => <Controlled {...args} />,
  args: { item: mkItem(), asset: mkAsset({ status: 'uploading' }), playing: false, volume: 0.7 },
};

export const PendingProcessing: Story = {
  render: (args) => <Controlled {...args} />,
  args: { item: mkItem(), asset: mkAsset({ status: 'processing' }), playing: false, volume: 0.7 },
};

export const Failed: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    item: mkItem(),
    asset: mkAsset({ status: 'failed', lastError: 'ffmpeg exited with code 1' }),
    playing: false,
    volume: 0.7,
  },
};

export const DecodeFailed: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    item: mkItem(),
    asset: mkAsset({ status: 'ready' }),
    decodeFailed: true,
    playing: false,
    volume: 0.7,
  },
};

/**
 * The dangling-reference case: the package item's `assetId` no longer
 * resolves to any asset (it was deleted from the library). Per the design
 * doc's failure-modes table this is an EXPECTED state, not a bug — the pad
 * must still render the item's own label and a specific reason, never throw
 * and never go blank.
 */
export const AssetDeleted: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    item: mkItem({ label: 'Thunder (deleted asset)' }),
    asset: undefined,
    playing: false,
    volume: 0.7,
  },
};
