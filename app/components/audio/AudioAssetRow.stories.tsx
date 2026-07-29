import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioAssetRow } from './AudioAssetRow';
import type { AudioAssetData } from '~/types/audio';

const base: AudioAssetData = {
  id: 'a1',
  ownerId: 'u1',
  title: 'Storm — Heavy',
  kind: 'ambience',
  environment: ['coast'],
  mood: ['tense'],
  intensity: 4,
  tags: ['storm', 'rain'],
  status: 'ready',
  durationMs: 125_000,
  durationSamples: 6_000_000,
  loudnessTargetLufs: -20,
  peaks: Array.from({ length: 200 }, (_, i) => Math.abs(Math.sin(i / 6)) * 0.8),
  renditions: {},
  lastError: null,
  createdAt: '',
  updatedAt: '',
};

const meta: Meta<typeof AudioAssetRow> = {
  title: 'Audio/AudioAssetRow',
  component: AudioAssetRow,
  tags: ['autodocs'],
  decorators: [
    // AudioAssetRow renders an <li> so it composes into AudioLibraryBrowser's
    // <ul> (Task 16). Standalone renders need that <ul> wrapper to stay
    // valid HTML.
    (Story) => (
      <ul className="max-w-lg divide-y divide-white/[0.06] bg-[#0D1117]">
        <Story />
      </ul>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: { asset: base, onPlay: () => {}, onEdit: () => {}, onDelete: () => {} },
};

export const Uploading: Story = {
  args: {
    asset: { ...base, status: 'uploading', peaks: [], durationMs: null },
    onEdit: () => {},
    onDelete: () => {},
  },
};

/**
 * Queued but not yet claimed by a worker. Deliberately distinct copy from
 * "Processing…" — if the worker is down, assets pile up here, and the
 * design mandates that a stalled queue must be visible, not disguised as
 * an in-progress spinner.
 *
 * Edit is reachable here (and for every non-ready status below) — the edit
 * modal (Task 21) only touches metadata, which doesn't depend on the audio
 * having finished processing. Only Play stays gated on `ready`.
 */
export const Pending: Story = {
  args: {
    asset: { ...base, status: 'pending', peaks: [], durationMs: null },
    onEdit: () => {},
    onDelete: () => {},
  },
};

export const Processing: Story = {
  args: {
    asset: { ...base, status: 'processing', peaks: [], durationMs: null },
    onEdit: () => {},
    onDelete: () => {},
  },
};

/**
 * Failed rows carry a Retry action alongside the reason. The source object
 * survives everything but delete, so a transcode that lost to a transient
 * fault is recoverable without re-uploading — otherwise the only recovery for
 * a 50-file bulk import is re-dropping the whole folder.
 */
export const Failed: Story = {
  args: {
    asset: {
      ...base,
      status: 'failed',
      lastError: 'Unsupported codec',
      peaks: [],
      durationMs: null,
    },
    onEdit: () => {},
    onDelete: () => {},
    onRetry: () => {},
  },
};

export const FailedNoMessage: Story = {
  args: {
    asset: { ...base, status: 'failed', lastError: null, peaks: [], durationMs: null },
    onEdit: () => {},
    onDelete: () => {},
    onRetry: () => {},
  },
};

function SelectableExample(args: React.ComponentProps<typeof AudioAssetRow>) {
  const [selected, setSelected] = useState(Boolean(args.selected));
  return (
    <AudioAssetRow {...args} selected={selected} onToggleSelect={() => setSelected((s) => !s)} />
  );
}

export const Selectable: Story = {
  render: (args) => <SelectableExample {...args} />,
  args: { asset: base, selectable: true, selected: true, onEdit: () => {}, onDelete: () => {} },
};

export const NoTags: Story = {
  args: { asset: { ...base, tags: [] } },
};
