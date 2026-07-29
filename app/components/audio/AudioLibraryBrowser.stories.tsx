import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioLibraryBrowser } from './AudioLibraryBrowser';
import type { AudioFilters } from './AudioFilterBar';
import type { AudioAssetData } from '~/types/audio';

const mk = (
  id: string,
  title: string,
  kind: AudioAssetData['kind'],
  overrides: Partial<AudioAssetData> = {}
): AudioAssetData => ({
  id,
  ownerId: 'u1',
  title,
  kind,
  environment: [],
  mood: [],
  intensity: 3,
  tags: ['demo'],
  status: 'ready',
  durationMs: 90_000,
  loudnessLufs: -20,
  peaks: Array.from({ length: 120 }, (_, i) => Math.abs(Math.sin(i / 5)) * 0.7),
  renditions: {},
  lastError: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const assets: AudioAssetData[] = [
  mk('1', 'Storm — Heavy', 'ambience', { environment: ['coast'], mood: ['tense'] }),
  mk('2', 'Tavern Reel', 'music', { environment: ['tavern'], mood: ['festive'] }),
  mk('3', 'Sword Clang', 'one-shot', { tags: [] }),
];

const meta: Meta<typeof AudioLibraryBrowser> = {
  title: 'Audio/AudioLibraryBrowser',
  component: AudioLibraryBrowser,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-3xl bg-[#0D1117]">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(args: React.ComponentProps<typeof AudioLibraryBrowser>) {
  const [filters, setFilters] = useState<AudioFilters>(args.filters);
  return <AudioLibraryBrowser {...args} filters={filters} onFiltersChange={setFilters} />;
}

export const WithAssets: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    assets,
    filters: {},
    onFiltersChange: () => {},
    onPlay: () => {},
    onEdit: () => {},
    onDelete: () => {},
  },
};

export const Loading: Story = {
  render: (args) => <Controlled {...args} />,
  args: { assets: [], loading: true, filters: {}, onFiltersChange: () => {} },
};

export const EmptyState: Story = {
  render: (args) => <Controlled {...args} />,
  args: { assets: [], filters: { kind: 'music' }, onFiltersChange: () => {} },
};

/**
 * Selectable "manage" usage: bulk actions bar above the list, a checkbox
 * per row. The picker usage (phase 2) mounts the exact same component with
 * a different `actionsSlot` and no fork.
 */
function SelectableExample(args: React.ComponentProps<typeof AudioLibraryBrowser>) {
  const [filters, setFilters] = useState<AudioFilters>(args.filters);
  const [selectedIds, setSelectedIds] = useState<string[]>(['1']);
  return (
    <AudioLibraryBrowser
      {...args}
      filters={filters}
      onFiltersChange={setFilters}
      selectable
      selectedIds={selectedIds}
      onToggleSelect={(id) =>
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      }
      actionsSlot={
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
          {selectedIds.length} selected
          <button type="button" className="rounded bg-white/[0.06] px-2 py-1 text-slate-200">
            Bulk tag…
          </button>
        </div>
      }
    />
  );
}

export const SelectableWithActionsSlot: Story = {
  render: (args) => <SelectableExample {...args} />,
  args: { assets, filters: {}, onFiltersChange: () => {}, onDelete: () => {} },
};
