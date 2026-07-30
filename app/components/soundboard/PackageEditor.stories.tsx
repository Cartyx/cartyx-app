import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PackageEditor } from './PackageEditor';
import type { AudioFilters } from '~/components/audio/AudioFilterBar';
import { MAX_PACKAGE_ITEMS } from '~/types/soundboard';
import type { PackageItemData } from '~/types/soundboard';
import type { AudioAssetData } from '~/types/audio';

const mkAsset = (
  id: string,
  title: string,
  overrides: Partial<AudioAssetData> = {}
): AudioAssetData => ({
  id,
  ownerId: 'u1',
  title,
  kind: 'ambience',
  environment: [],
  mood: [],
  intensity: 3,
  tags: [],
  status: 'ready',
  durationMs: 90_000,
  durationSamples: 4_320_000,
  loudnessTargetLufs: -20,
  peaks: Array.from({ length: 80 }, (_, i) => Math.abs(Math.sin(i / 5)) * 0.7),
  renditions: {},
  lastError: null,
  permanentFailure: false,
  retryable: false,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const assets: AudioAssetData[] = [
  mkAsset('a1', 'Storm — Heavy', { environment: ['coast'] }),
  mkAsset('a2', 'Tavern Reel', { kind: 'music', environment: ['tavern'] }),
  mkAsset('a3', 'Sword Clang', { kind: 'one-shot', tags: [] }),
];

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

const meta: Meta<typeof PackageEditor> = {
  title: 'Soundboard/PackageEditor',
  component: PackageEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-4xl bg-[#080A12] p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Fully controlled, like `AudioLibraryBrowser` itself: `items`/`filters` are
 * local state here so the picker's checkboxes, "Add to package", and each
 * row's controls are all interactive in the Storybook canvas.
 */
function Controlled(args: React.ComponentProps<typeof PackageEditor>) {
  const [items, setItems] = useState(args.items);
  const [filters, setFilters] = useState<AudioFilters>(args.filters);
  return (
    <PackageEditor
      {...args}
      items={items}
      onItemsChange={setItems}
      filters={filters}
      onFiltersChange={setFilters}
    />
  );
}

export const WithItems: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    items: [
      mkItem({ id: 'i1', label: 'Rain', volume: 0.7, loop: true }),
      mkItem({
        id: 'i2',
        label: 'Distant Thunder',
        volume: 1,
        loop: false,
        sortIndex: 1,
        randomIntervalMin: 30,
        randomIntervalMax: 90,
      }),
    ],
    assets,
    filters: {},
  },
};

export const EmptyPackage: Story = {
  render: (args) => <Controlled {...args} />,
  args: { items: [], assets, filters: {} },
};

/**
 * `MAX_PACKAGE_ITEMS` items already present — "Add to package" is disabled
 * with an explanation, not merely a rejected round trip after the fact.
 */
export const AtItemCap: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    items: Array.from({ length: MAX_PACKAGE_ITEMS }, (_, i) =>
      mkItem({ id: `i${i}`, label: `Item ${i + 1}`, sortIndex: i })
    ),
    assets,
    filters: {},
  },
};

/** A system package: no picker, every item control disabled. */
export const ReadOnlySystemPackage: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    items: [mkItem({ id: 'i1', label: 'Storm Basics — Rain' })],
    assets,
    filters: {},
    readOnly: true,
  },
};
