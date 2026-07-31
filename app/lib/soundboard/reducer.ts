import { resolveItemState, type ResolvedItemState } from '~/lib/soundboard/resolve';
import type { SoundboardCommand } from '~/lib/soundboard/commands';
import { DEFAULT_VOLUME } from '~/types/soundboard';
import type { AudioPackageData, MoodData } from '~/types/soundboard';

/** One item's resolved playback state, tagged with which item it belongs
 * to. This is `ResolvedItemState` (Task 8) — the exact shape the Web Audio
 * engine (Task 10) and the random one-shot scheduler (Task 11) consume —
 * plus the id needed to find it again on `play`/`stop`/`setItemVolume`. */
export type BoardItemState = ResolvedItemState & { itemId: string };

/**
 * The GM board's live, in-memory state. Richer than `BoardStateData` (Task
 * 1's persisted shape, which only stores `{ itemId, playing, volume }` per
 * item): every item here carries its full resolved playback state
 * (`fadeSeconds`, `loop`, `assetId`, the random-interval bounds) because
 * that is what Tasks 10 and 11 need to actually act on the state, not just
 * what needs to survive a reload. `pkg` is the whole loaded package
 * (`items`/`moods` included) so `setMood` can resolve every item without
 * a network call — see `commands.ts` for why `loadPackage` carries the same
 * thing rather than a bare id.
 */
export type BoardState = {
  pkg: AudioPackageData | null;
  moodId: string | null;
  items: BoardItemState[];
  masterVolume: number;
};

/**
 * Resolves every item in `pkg` against `mood` (or no mood at all). Always
 * iterates `pkg.items` — never `mood?.states` — so an item the mood doesn't
 * name still gets a `resolveItemState(item, undefined)` call and comes back
 * `playing: false`. Iterating the mood's states instead is the bug this
 * whole task exists to prevent: switching mood would leave any item the new
 * mood doesn't mention still running from the previous scene.
 */
function resolveAllItems(pkg: AudioPackageData, mood: MoodData | undefined): BoardItemState[] {
  return pkg.items.map((item) => {
    const moodState = mood?.states.find((s) => s.itemId === item.id);
    return { itemId: item.id, ...resolveItemState(item, moodState) };
  });
}

/**
 * The board state for a freshly loaded package, or for no package at all.
 * `pkg: null` represents "nothing loaded" — a fresh campaign's board, per
 * `BoardStateData.packageId: string | null` (Task 1) and `loadBoardStateFn`
 * (Task 6/7), which returns `null` for a campaign with no saved state.
 *
 * Deliberately does NOT auto-select a mood: `moodId` starts `null` and
 * every item resolves via `resolveItemState(item, undefined)`, i.e.
 * not-playing. Nothing in a freshly loaded package indicates which mood's
 * overrides should apply, so silently picking one (e.g. `moods[0]`) would
 * mean a package load can start audio without any GM action — the same
 * "surprise sound" failure `enableAudio()`'s explicit gesture (Task 12)
 * exists to prevent one layer up.
 *
 * `masterVolume` starts at `DEFAULT_VOLUME` (1, from `~/types/soundboard`)
 * — full volume, so a freshly loaded board is immediately usable once the
 * GM presses a pad, rather than silently muted.
 */
export function initialBoardState(pkg: AudioPackageData | null): BoardState {
  if (!pkg) {
    return { pkg: null, moodId: null, items: [], masterVolume: DEFAULT_VOLUME };
  }
  return {
    pkg,
    moodId: null,
    items: resolveAllItems(pkg, undefined),
    masterVolume: DEFAULT_VOLUME,
  };
}

/**
 * Applies one `SoundboardCommand` to `state`, returning a NEW `BoardState`.
 * Pure: no audio, no network, no `Date.now()`, no `Math.random()`, and
 * never writes into `state` or any value reachable from it — every branch
 * below returns a fresh object (or, for no-op branches, the same
 * reference — never a mutated one).
 *
 * Every known command has its own `case`; the trailing `default` exists
 * only for exhaustiveness (see its comment below) and returns `state`
 * unchanged for anything it reaches at runtime.
 */
export function boardReducer(state: BoardState, command: SoundboardCommand): BoardState {
  switch (command.type) {
    case 'loadPackage':
      // `masterVolume` is a board/output property, not a package property —
      // it must survive a package switch. Without this, a GM who dialed
      // master down to 0.4 gets full volume on the very next pad after
      // switching packages: the same "surprise loud audio" failure
      // `initialBoardState`'s "no auto-selected mood" choice exists to
      // prevent, reintroduced through the one field `initialBoardState`
      // can't know isn't meant to reset.
      return { ...initialBoardState(command.pkg), masterVolume: state.masterVolume };

    case 'setMood': {
      if (!state.pkg) return state;
      const mood = state.pkg.moods.find((m) => m.id === command.moodId);
      // An unrecognized moodId (e.g. a 2b client on a stale package) must
      // leave the board exactly as it was, not silence every item. Without
      // this guard, `mood` resolves to `undefined` and every item resolves
      // via `resolveItemState(item, undefined)` — indistinguishable from
      // "explicitly switch to no mood" — which is not what an unknown id
      // means.
      if (!mood) return state;
      return {
        ...state,
        moodId: command.moodId,
        items: resolveAllItems(state.pkg, mood),
      };
    }

    case 'play':
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemId === command.itemId ? { ...item, playing: true } : item
        ),
      };

    case 'stop':
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemId === command.itemId ? { ...item, playing: false } : item
        ),
      };

    // Transient by design: a random ambient fire has no lasting effect on
    // the board's state. It does not set `playing` (a one-shot ends on its
    // own; there is nothing to "leave on" for the reducer to represent) and
    // is not recorded anywhere else in `BoardState`. Task 11's scheduler
    // emits this command on a timer, and Task 12 debounces `saveBoardStateFn`
    // off state changes — if `fireOneShot` touched state, every random
    // thunder crack would eventually write to Atlas. The engine (Task 10)
    // must react to the dispatched command itself to trigger playback, not
    // to a diff in `state.items`.
    case 'fireOneShot':
      return state;

    case 'setItemVolume':
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemId === command.itemId ? { ...item, volume: command.volume } : item
        ),
      };

    case 'setMasterVolume':
      return { ...state, masterVolume: command.volume };

    // A panic button, not a reset: stops every item without touching `pkg`
    // or `moodId`. Unloading is a `loadPackage` (or a fresh `initialBoardState`),
    // never implied by stopping playback.
    case 'stopAll':
      return {
        ...state,
        items: state.items.map((item) => ({ ...item, playing: false })),
      };

    default: {
      // Compile-time exhaustiveness only: `command` failing to narrow to
      // `never` here is what makes an unhandled `SoundboardCommand` variant
      // a `npm run typecheck` failure. At runtime, 2b feeds this reducer
      // values that arrived off a wire — exactly where a value with an
      // unrecognized `type` can turn up despite the union being closed at
      // compile time. Returning `_never` itself would hand that object to
      // `useReducer` *as* `BoardState`, which Task 10's engine and Task 12's
      // debounced Atlas save would then both act on. Return `state`
      // unchanged instead — ignore what wasn't understood.
      const _never: never = command;
      return state;
    }
  }
}
