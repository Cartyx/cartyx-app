import type { Meta, StoryObj } from '@storybook/react-vite';
import { BoardGrid } from './BoardGrid';
import type { AudioAssetData, AudioKind } from '~/types/audio';
import type { PackageItemData } from '~/types/soundboard';
import type { BoardItemState } from '~/lib/soundboard/reducer';

const meta: Meta<typeof BoardGrid> = {
  title: 'Soundboard/BoardGrid',
  component: BoardGrid,
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

function item(
  id: string,
  assetId: string,
  label: string,
  sortIndex: number,
  volume = 0.7
): PackageItemData {
  return { id, assetId, label, volume, fadeSeconds: 2, loop: true, sortIndex };
}

function asset(id: string, kind: AudioKind, over: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id,
    ownerId: 'u1',
    title: id,
    kind,
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 120_000,
    durationSamples: 5_760_000,
    loudnessTargetLufs: null,
    peaks: [],
    renditions: { opus: { key: 'k', url: 'https://cdn.example/x.opus', bytes: 1 } },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function state(itemId: string, over: Partial<BoardItemState> = {}): BoardItemState {
  return {
    itemId,
    assetId: 'a',
    playing: false,
    volume: 0.7,
    fadeSeconds: 2,
    loop: true,
    randomIntervalMin: undefined,
    randomIntervalMax: undefined,
    ...over,
  };
}

const noop = () => {};

// Array order deliberately disagrees with sortIndex order.
const items = [
  item('i3', 'a3', 'Thunder', 2),
  item('i1', 'a1', 'Battle Theme', 0),
  item('i2', 'a2', 'Rain', 1),
];

export const AllThreeKinds: Story = {
  args: {
    items,
    assets: [asset('a1', 'music'), asset('a2', 'ambience'), asset('a3', 'one-shot')],
    itemStates: [state('i1', { playing: true }), state('i2', { volume: 0.35 }), state('i3')],
    onPlay: noop,
    onStop: noop,
    onVolumeChange: noop,
  },
};

/**
 * The edge the grouping exists to handle: `i3`'s asset was deleted from the
 * library, so it has no `kind` at all. It must stay visible — the naive
 * `groups[asset.kind].push(item)` drops it from every group and the GM can
 * neither play it nor find it to remove it.
 */
export const WithADanglingReference: Story = {
  args: {
    items,
    assets: [asset('a1', 'music'), asset('a2', 'ambience')],
    itemStates: [state('i1'), state('i2'), state('i3')],
    onPlay: noop,
    onStop: noop,
    onVolumeChange: noop,
  },
};

/**
 * The engine could not decode `a1`'s rendition — a 404'd object, or bytes this
 * browser cannot decode. The engine's `unplayable` set is never cleared, so
 * this pad is silent for the rest of the session; without this state it would
 * keep looking perfectly ready.
 */
export const ARenditionFailedToDecode: Story = {
  args: {
    items: [item('i1', 'a1', 'Battle Theme', 0), item('i2', 'a2', 'Rain', 1)],
    assets: [asset('a1', 'music'), asset('a2', 'ambience')],
    itemStates: [state('i1'), state('i2')],
    loadErrors: new Set(['a1']),
    onPlay: noop,
    onStop: noop,
    onVolumeChange: noop,
  },
};

export const StillTranscoding: Story = {
  args: {
    items: [item('i1', 'a1', 'Battle Theme', 0)],
    assets: [asset('a1', 'music', { status: 'processing' })],
    itemStates: [state('i1')],
    onPlay: noop,
    onStop: noop,
    onVolumeChange: noop,
  },
};

export const EmptyPackage: Story = {
  args: {
    items: [],
    assets: [],
    itemStates: [],
    onPlay: noop,
    onStop: noop,
    onVolumeChange: noop,
  },
};
