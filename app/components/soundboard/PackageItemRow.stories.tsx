import type { Meta, StoryObj } from '@storybook/react-vite';
import { PackageItemRow } from './PackageItemRow';
import type { PackageItemData } from '~/types/soundboard';

function makeItem(overrides: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: '507f1f77bcf86cd799439011',
    label: 'Distant Thunder',
    volume: 0.8,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 0,
    ...overrides,
  };
}

const meta: Meta<typeof PackageItemRow> = {
  title: 'Soundboard/PackageItemRow',
  component: PackageItemRow,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ul className="max-w-3xl divide-y divide-white/[0.06] rounded border border-white/[0.06] bg-[#0D1117]">
        <Story />
      </ul>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Looping: Story = {
  args: { item: makeItem(), onChange: () => {}, onRemove: () => {} },
};

/** A one-shot with no loop and a random-fire interval — "thunder goes off occasionally". */
export const RandomOneShot: Story = {
  args: {
    item: makeItem({
      label: 'Thunder Crack',
      loop: false,
      volume: 1,
      randomIntervalMin: 30,
      randomIntervalMax: 90,
    }),
    onChange: () => {},
    onRemove: () => {},
  },
};

/** `randomIntervalMin > randomIntervalMax` — the pair `packageItemSchema` would reject on save. Flagged inline rather than only failing at Save. */
export const InvalidRandomInterval: Story = {
  args: {
    item: makeItem({ randomIntervalMin: 120, randomIntervalMax: 30 }),
    onChange: () => {},
    onRemove: () => {},
  },
};

/** An item whose asset predates the `label` field, or whose asset is no longer loaded in the picker's current page — falls back to a short id fragment. */
export const NoLabel: Story = {
  args: { item: makeItem({ label: undefined }), onChange: () => {}, onRemove: () => {} },
};

/** System-package row: every control disabled, no remove affordance. */
export const ReadOnly: Story = {
  args: { item: makeItem(), onChange: () => {}, onRemove: () => {}, readOnly: true },
};
