import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoodEditor } from './MoodEditor';
import type { MoodData, PackageItemData } from '~/types/soundboard';
import { MAX_PACKAGE_MOODS } from '~/types/soundboard';

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

const items: PackageItemData[] = [
  mkItem({ id: 'i1', label: 'Rain', volume: 0.7, sortIndex: 0 }),
  mkItem({
    id: 'i2',
    label: 'Distant Thunder',
    volume: 1,
    loop: false,
    sortIndex: 1,
    randomIntervalMin: 30,
    randomIntervalMax: 90,
  }),
  mkItem({ id: 'i3', label: 'Tavern Chatter', volume: 0.5, sortIndex: 2 }),
];

const meta: Meta<typeof MoodEditor> = {
  title: 'Soundboard/MoodEditor',
  component: MoodEditor,
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

/** Fully controlled, like `PackageEditor` itself — `moods` is local state so every control is interactive in the Storybook canvas. */
function Controlled(args: React.ComponentProps<typeof MoodEditor>) {
  const [moods, setMoods] = useState(args.moods);
  return <MoodEditor {...args} moods={moods} onMoodsChange={setMoods} />;
}

/**
 * `Overhead` plays Rain quietly and lets Thunder fire occasionally; Tavern
 * Chatter is untouched by this mood and inherits — resolves to not playing.
 * `Storm Peak` overrides Rain's volume to the SAME 0.7 the item already has,
 * on purpose: it still shows the "mood" marker, which is the whole point of
 * this component (see the task's test suite for why that has to hold).
 */
export const WithMoods: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    items,
    moods: [
      {
        id: 'm1',
        name: 'Overhead',
        states: [
          { itemId: 'i1', playing: true, volume: 0.3 },
          { itemId: 'i2', playing: true },
        ],
      },
      {
        id: 'm2',
        name: 'Storm Peak',
        states: [
          { itemId: 'i1', playing: true, volume: 0.7 },
          { itemId: 'i2', playing: true, volume: 1, fadeSeconds: 0 },
        ],
      },
    ],
  },
};

export const NoMoodsYet: Story = {
  render: (args) => <Controlled {...args} />,
  args: { items, moods: [] },
};

/** `MAX_PACKAGE_MOODS` moods already present — "Add mood" is disabled with an explanation. */
export const AtMoodCap: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    items,
    moods: Array.from({ length: MAX_PACKAGE_MOODS }, (_, i): MoodData => ({
      id: `m${i}`,
      name: `Mood ${i + 1}`,
      states: [],
    })),
  },
};

/** A system package: no add/rename/remove mood, no clear-override buttons — markers still show. */
export const ReadOnlySystemPackage: Story = {
  render: (args) => <Controlled {...args} />,
  args: {
    items,
    moods: [
      {
        id: 'm1',
        name: 'Overhead',
        states: [{ itemId: 'i1', playing: true, volume: 0.3 }],
      },
    ],
    readOnly: true,
  },
};
