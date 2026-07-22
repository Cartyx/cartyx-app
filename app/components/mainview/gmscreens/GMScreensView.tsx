import React, { useState, useCallback, useRef, useEffect, useMemo, type DragEvent } from 'react';
import { Plus, Layers, Loader2, AlertTriangle, Globe, Lock, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGMScreenList, useGMScreenDetail, useGMScreenMutations } from '~/hooks/useGMScreens';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import {
  FloatingWindowManager,
  type ManagedWindow,
} from '~/components/mainview/FloatingWindowManager';
import type { FloatingWindowState } from '~/components/mainview/FloatingWindow';
import type { WindowState } from '~/types/gmscreen';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import { CharacterWindowWrapper, EditCharacterModalWrapper } from './CharacterWindowWrapper';
import { LoreWindowWrapper, EditLoreModalWrapper } from './LoreWindowWrapper';
import {
  OrganizationWindowWrapper,
  EditOrganizationModalWrapper,
} from '~/components/wiki/organizations/OrganizationWindowWrapper';
import {
  QuestWindowWrapper,
  EditQuestModalWrapper,
} from '~/components/wiki/quests/QuestWindowWrapper';
import { EventWindowWrapper } from './EventWindowWrapper';
import { RaceWindowWrapper, EditRaceModalWrapper } from '~/components/wiki/races/RaceWindowWrapper';
import { RuleWindowWrapper, EditRuleModalWrapper } from './RuleWindowWrapper';
import {
  PlayerWindowWrapper,
  EditPlayerModalWrapper,
} from '~/components/wiki/players/PlayerWindowWrapper';
import {
  LocationWindowWrapper,
  EditLocationModalWrapper,
} from '~/components/wiki/locations/LocationWindowWrapper';
import {
  MonsterWindowWrapper,
  EditMonsterModalWrapper,
} from '~/components/wiki/monsters/MonsterWindowWrapper';
import {
  SpellWindowWrapper,
  EditSpellModalWrapper,
} from '~/components/wiki/spells/SpellWindowWrapper';
import { GMScreenDialogs, type DialogState } from './GMScreenDialogs';
import { ScreenBar } from './ScreenBar';
import { StackCard } from './StackCard';

export interface GMScreensViewProps {
  campaignId: string;
  isGM?: boolean;
}

const DEBOUNCE_MS = 500;

/** Map FloatingWindow states to backend WindowState values. */
function toWindowState(state: FloatingWindowState): WindowState {
  if (state === 'minimized') return 'minimized';
  if (state === 'maximized') return 'open';
  return 'open';
}

/** Map backend WindowState to FloatingWindow states. */
function toFloatingState(state: string): FloatingWindowState {
  if (state === 'minimized') return 'minimized';
  return 'normal';
}

export function GMScreensView({ campaignId, isGM = true }: GMScreensViewProps) {
  const { screens, isLoading: listLoading, error: listError } = useGMScreenList(campaignId);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  // Local state stays the render source of truth (tab clicks must not wait on a
  // round-trip); player state is only *seeded from* on mount and *synced to* on
  // user-initiated changes. The wiki (a sibling subtree) reads it from there.
  const {
    playerState,
    isLoading: playerStateLoading,
    updateState,
    removePrivateWindow,
  } = useTabletopPlayerState(campaignId);
  const removePrivateWindowMutate = removePrivateWindow.mutate;
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const mutations = useGMScreenMutations(campaignId);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editingMonsterId, setEditingMonsterId] = useState<string | null>(null);
  const [editingLoreId, setEditingLoreId] = useState<string | null>(null);
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  const [editingQuestId, setEditingQuestId] = useState<string | null>(null);
  const [editingSpellId, setEditingSpellId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [flashWindowId, setFlashWindowId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Collision-safe primitive key that tracks the *set* of screen IDs.
  // Sorted so harmless order changes (reorder, query refetch jitter) don't
  // trigger re-runs — only actual additions/removals change this value.
  const screenIdsKey = useMemo(
    () => JSON.stringify([...screens.map((s) => s.id)].sort()),
    [screens]
  );

  // Ref to current ordered screens so the auto-select effect can pick the
  // first screen by tab-order without adding `screens` to its dep array.
  const screensRef = useRef(screens);
  screensRef.current = screens;

  // Ref to the persisted screen id so the auto-select effect can read it
  // without re-running every time our own persist call round-trips.
  const restoredScreenIdRef = useRef<string | null>(null);
  restoredScreenIdRef.current = playerState?.activeGMScreenId ?? null;

  // Whether the one-time restore from player state has already happened.
  const hasSeededRef = useRef(false);

  // GMScreensView isn't remounted on a campaignId change (no `key` at the
  // call site, and TanStack Router v1 doesn't remount on a path-param
  // change), so hasSeededRef must be reset by hand when the campaign
  // switches — otherwise campaign B's first pass sees hasSeededRef already
  // true and falls back to screens[0] instead of restoring ITS persisted
  // screen. Comparing-during-render (not in an effect) mirrors the ref
  // writes above and ensures the reset lands before the seeding effect runs.
  const prevCampaignIdRef = useRef(campaignId);
  if (prevCampaignIdRef.current !== campaignId) {
    prevCampaignIdRef.current = campaignId;
    hasSeededRef.current = false;
  }

  // Auto-select a screen once the list has settled (not while loading).
  // Uses screenIdsKey (primitive) so it only fires when the set of IDs
  // changes, and a functional update to avoid activeScreenId in deps.
  // On the FIRST pass it also waits for player state so it can restore the
  // GM's last screen instead of flashing screens[0]; afterwards player state
  // is ignored here and only written to.
  useEffect(() => {
    if (listLoading) return;
    const current = screensRef.current;
    if (current.length === 0) {
      setActiveScreenId(null);
      return;
    }
    // Only the initial seed waits on player state; later list changes must not.
    if (!hasSeededRef.current && playerStateLoading) return;

    const idSet = new Set(current.map((s) => s.id));
    // Restore the GM's last screen. Falls back to the first screen on first
    // visit (activeGMScreenId is null until they pick one) and when the
    // persisted screen has since been deleted.
    const restored = hasSeededRef.current ? null : restoredScreenIdRef.current;
    hasSeededRef.current = true;
    const fallback = restored && idSet.has(restored) ? restored : current[0]!.id;

    setActiveScreenId((prev) => (prev && idSet.has(prev) ? prev : fallback));
  }, [screenIdsKey, listLoading, playerStateLoading]);

  // Clear drag highlight when switching screens
  useEffect(() => {
    setIsDragOver(false);
    setFlashWindowId(null);
  }, [activeScreenId]);

  const {
    screen: activeScreen,
    isLoading: detailLoading,
    error: detailError,
  } = useGMScreenDetail(campaignId, activeScreenId);

  // The caller's own private windows for this GM screen. GM screens are
  // campaign-scoped and shared between co-GMs, so "private" still means
  // something here: these live on player state, are only ever returned to their
  // owner, and no other GM sees them.
  const privateWindows = useMemo(
    () =>
      (playerState?.privateWindows ?? []).filter(
        (pw) => pw.surface === 'gmscreen' && pw.screenId === activeScreenId
      ),
    [playerState, activeScreenId]
  );

  // --- Debounced persistence refs ---
  // Per-window timers so multi-window updates don't clobber each other
  const updateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Store pending payloads so they can be flushed on unmount
  const pendingUpdatesRef = useRef<
    Map<string, Parameters<typeof mutations.updateWindow.mutate>[0]>
  >(new Map());

  // Ref kept current to the (referentially-stable, but not statically provable)
  // updateWindow mutate fn so the unmount-only flush below can call the latest
  // one without listing `mutations` as a dependency.
  const updateWindowMutateRef = useRef(mutations.updateWindow.mutate);
  updateWindowMutateRef.current = mutations.updateWindow.mutate;

  // Flush pending updates on unmount instead of discarding them. This is
  // deliberately an unmount-only ([]) effect: useGMScreenMutations returns a
  // FRESH object every render, so a [mutations] dep would run this cleanup on
  // EVERY render — clearing the debounce timer set moments earlier by
  // handleWindowsChange AND firing updateWindow for every pending payload. That
  // turned the 500ms debounce into a POST on essentially every drag/resize
  // frame. Reading the mutate fn through updateWindowMutateRef keeps the flush
  // correct without depending on `mutations`.
  useEffect(() => {
    const timers = updateTimersRef.current;
    const pending = pendingUpdatesRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const payload of pending.values()) {
        updateWindowMutateRef.current(payload);
      }
      pending.clear();
    };
  }, []);

  // Flash timer cleanup is deliberately its OWN unmount-only effect. It used to
  // live in the flush effect above, whose deps are [mutations] — and
  // useGMScreenMutations returns a fresh object every render, so that cleanup
  // runs on every render, not just unmount. It therefore cleared the 700ms
  // timer immediately after setFlashWindowId re-rendered, and the flash class
  // stuck on the window forever instead of fading.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // --- Screen selection ---

  const updateStateMutate = updateState.mutate;

  // Persist on user-initiated selection only. Local state updates first so the
  // tab switch is instant; the write is fire-and-forget. NOT called from the
  // seeding effect above — that would write on every mount.
  const handleSelectScreen = useCallback(
    (id: string) => {
      setActiveScreenId(id);
      updateStateMutate({ activeGMScreenId: id });
    },
    [updateStateMutate]
  );

  // --- Screen CRUD handlers ---

  const handleCreateScreen = useCallback(
    async (name: string) => {
      const result = await mutations.createScreen.mutateAsync(name);
      if (result?.screen) {
        setActiveScreenId(result.screen.id);
        updateStateMutate({ activeGMScreenId: result.screen.id });
      }
      // Invalidate list AFTER selection is set to prevent the auto-select
      // effect from briefly choosing a different screen during the refetch.
      mutations.invalidateList();
      setDialog({ type: 'none' });
    },
    [mutations, updateStateMutate]
  );

  const handleRenameScreen = useCallback(
    async (name: string) => {
      if (dialog.type !== 'rename-screen') return;
      await mutations.renameScreen.mutateAsync({ id: dialog.screenId, name });
      setDialog({ type: 'none' });
    },
    [dialog, mutations.renameScreen]
  );

  const handleDeleteScreen = useCallback(async () => {
    if (dialog.type !== 'delete-screen') return;
    const deletingId = dialog.screenId;
    const currentScreens = screensRef.current;

    // Snapshot the window IDs before changing selection (activeScreen will
    // become stale once activeScreenId changes).
    const windowIds = activeScreen?.windows.map((w) => w.id) ?? [];

    // Optimistically move selection BEFORE the mutation so activeScreenId
    // never points to a deleted screen (avoids bounce / invalid detail fetch).
    const idx = currentScreens.findIndex((s) => s.id === deletingId);
    const nextScreen = currentScreens[idx + 1] ?? currentScreens[idx - 1] ?? null;
    setActiveScreenId(nextScreen?.id ?? null);
    updateStateMutate({ activeGMScreenId: nextScreen?.id ?? null });

    // Clear any pending debounced window-update timers for the deleted screen's windows
    const windowIdSet = new Set(windowIds);
    for (const [timerId, timer] of updateTimersRef.current) {
      if (windowIdSet.has(timerId)) {
        clearTimeout(timer);
        updateTimersRef.current.delete(timerId);
      }
    }

    await mutations.deleteScreen.mutateAsync(deletingId);
    // Invalidate list AFTER mutation + selection to avoid race
    mutations.invalidateList();
    setDialog({ type: 'none' });
  }, [dialog, mutations, activeScreen, updateStateMutate]);

  const handleReorder = useCallback(
    async (screenIds: string[]) => {
      await mutations.reorderScreens.mutateAsync(screenIds);
      setDialog({ type: 'none' });
    },
    [mutations.reorderScreens]
  );

  // --- Window handlers ---

  const handleWindowsChange = useCallback(
    (nextWindows: ManagedWindow[]) => {
      // Optimistically update local state immediately
      setLocalWindows(nextWindows);

      const nextIds = new Set(nextWindows.map((w) => w.id));

      // Route each disappeared window by the list it came from, NOT by a tag
      // riding on the ManagedWindow (which could go stale). A private window
      // must never go through closeWindow: that mutation removes the SHARED
      // window from GMScreen.windows for every GM of the campaign.
      for (const pw of privateWindows) {
        if (!nextIds.has(pw.id)) {
          removePrivateWindowMutate({ privateWindowId: pw.id });
        }
      }

      if (!activeScreenId || !activeScreen) return;

      // Persist layout changes debounced — one timer per window. Private
      // windows have no `orig` here and are skipped: updateWindow addresses
      // GMScreen.windows by id and has nothing to write for them.
      for (const nw of nextWindows) {
        const orig = activeScreen.windows.find((w) => w.id === nw.id);
        if (!orig) continue;

        const hasLayoutChange =
          nw.position?.x !== (orig.x ?? undefined) ||
          nw.position?.y !== (orig.y ?? undefined) ||
          nw.size?.width !== (orig.width ?? undefined) ||
          nw.size?.height !== (orig.height ?? undefined) ||
          nw.zIndex !== orig.zIndex ||
          toWindowState(nw.state) !== orig.state;

        if (hasLayoutChange) {
          const payload = {
            screenId: activeScreenId,
            windowId: nw.id,
            x: nw.position?.x ?? null,
            y: nw.position?.y ?? null,
            width: nw.size?.width ?? null,
            height: nw.size?.height ?? null,
            zIndex: nw.zIndex,
            state: toWindowState(nw.state),
          };
          pendingUpdatesRef.current.set(nw.id, payload);

          const existing = updateTimersRef.current.get(nw.id);
          if (existing) clearTimeout(existing);
          updateTimersRef.current.set(
            nw.id,
            setTimeout(() => {
              updateTimersRef.current.delete(nw.id);
              pendingUpdatesRef.current.delete(nw.id);
              mutations.updateWindow.mutate(payload);
            }, DEBOUNCE_MS)
          );
        }
      }

      // Handle shared closes — clear pending timers before firing the mutation
      for (const w of activeScreen.windows) {
        if (!nextIds.has(w.id)) {
          const pending = updateTimersRef.current.get(w.id);
          if (pending) {
            clearTimeout(pending);
            updateTimersRef.current.delete(w.id);
          }
          mutations.closeWindow.mutate({ screenId: activeScreenId, windowId: w.id });
        }
      }
    },
    [activeScreenId, activeScreen, mutations, privateWindows, removePrivateWindowMutate]
  );

  const openWindow = mutations.openWindow.mutate;
  const handleOpenItem = useCallback(
    (collection: string, documentId: string) => {
      if (!activeScreenId) return;
      openWindow({ screenId: activeScreenId, collection, documentId });
    },
    [activeScreenId, openWindow]
  );

  // Focus + flash an already-open window (shared or private) — the single flash
  // path for both the drop handler and wiki focus requests.
  //
  // A SHARED window's z-index is campaign-wide layout, so it persists through
  // updateWindow (unchanged from the drop handler's original behaviour). A
  // PRIVATE window has no such mutation — updateWindow addresses
  // GMScreen.windows and would not find it — and its stacking is the owner's
  // own business, so it is raised in local state only.
  const focusWindow = useCallback(
    (windowId: string) => {
      const shared = activeScreen?.windows.find((w) => w.id === windowId);

      if (shared && activeScreenId) {
        // Max across BOTH kinds: raising above only the shared windows could
        // still leave the target underneath one of the caller's own private
        // windows.
        const maxZ = [...(activeScreen?.windows ?? []), ...privateWindows].reduce(
          (max, w) => Math.max(max, w.zIndex),
          0
        );
        mutations.updateWindow.mutate({
          screenId: activeScreenId,
          windowId,
          zIndex: maxZ + 1,
          state: 'open',
        });
      } else {
        setLocalWindows((prev) => {
          const target = prev.find((w) => w.id === windowId);
          if (!target) return prev;
          const maxZ = prev.reduce((max, w) => Math.max(max, w.zIndex), 0);
          if (target.zIndex === maxZ && target.state !== 'minimized') return prev;
          return prev.map((w) =>
            w.id === windowId
              ? { ...w, zIndex: maxZ + 1, state: w.state === 'minimized' ? 'normal' : w.state }
              : w
          );
        });
      }

      setFlashWindowId(windowId);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null;
        setFlashWindowId(null);
      }, 700);
    },
    [activeScreen, activeScreenId, mutations, privateWindows]
  );

  // --- Focus requests from the wiki ("Show on Screen" on an already-open item) ---
  // The event detail carries no screenId, so match on collection+documentId
  // within the active screen, across both shared and private windows.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        campaignId?: string;
        surface?: string;
        collection?: string;
        documentId?: string;
      } | null;
      // Guard on campaign too — a stale/cross-campaign event must not focus a
      // window in this view.
      if (!detail || detail.surface !== 'gmscreen' || detail.campaignId !== campaignId) return;

      const match =
        privateWindows.find(
          (pw) => pw.collection === detail.collection && pw.documentId === detail.documentId
        ) ??
        activeScreen?.windows.find(
          (w) => w.collection === detail.collection && w.documentId === detail.documentId
        );
      if (!match) return;
      focusWindow(match.id);
    };

    window.addEventListener('cartyx:focus-window', onFocus);
    return () => window.removeEventListener('cartyx:focus-window', onFocus);
  }, [privateWindows, activeScreen, focusWindow, campaignId]);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!activeScreenId) return;
      if (!e.dataTransfer.types.includes('application/x-cartyx-document')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    },
    [activeScreenId]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the container, not when entering a child
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      if (!activeScreenId || !activeScreen) return;

      const raw = e.dataTransfer.getData('application/x-cartyx-document');
      if (!raw) return;

      let payload: { collection: string; documentId: string; title: string };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }

      // Check for duplicate
      const existing = activeScreen.windows.find(
        (w) => w.collection === payload.collection && w.documentId === payload.documentId
      );

      if (existing) {
        // Focus + flash the existing window
        focusWindow(existing.id);
        return;
      }

      // Calculate drop position relative to the workspace container
      const rect = workspaceRef.current?.getBoundingClientRect();
      const x = rect ? e.clientX - rect.left : 100;
      const y = rect ? e.clientY - rect.top : 100;

      mutations.openWindow.mutate({
        screenId: activeScreenId,
        collection: payload.collection,
        documentId: payload.documentId,
        x,
        y,
      });
    },
    [activeScreenId, activeScreen, mutations, focusWindow]
  );

  // --- Stack handlers ---

  const handleCreateStack = useCallback(
    async (name: string) => {
      if (!activeScreenId) return;
      await mutations.createStack.mutateAsync({ screenId: activeScreenId, name });
      setDialog({ type: 'none' });
    },
    [activeScreenId, mutations.createStack]
  );

  const handleRenameStack = useCallback(
    (stackId: string, name: string) => {
      if (!activeScreenId) return;
      mutations.renameStack.mutate({ screenId: activeScreenId, stackId, name });
    },
    [activeScreenId, mutations.renameStack]
  );

  const handleDeleteStack = useCallback(
    (stackId: string) => {
      if (!activeScreenId) return;
      mutations.deleteStack.mutate({ screenId: activeScreenId, stackId });
    },
    [activeScreenId, mutations.deleteStack]
  );

  const handleRemoveStackItem = useCallback(
    (stackId: string, itemId: string) => {
      if (!activeScreenId) return;
      mutations.removeStackItem.mutate({ screenId: activeScreenId, stackId, itemId });
    },
    [activeScreenId, mutations.removeStackItem]
  );

  // --- Local window state (optimistic) ---
  // Initialized from server, updated optimistically on user interaction,
  // re-synced when server data changes (e.g. after openWindow/closeWindow invalidation).

  const [localWindows, setLocalWindows] = useState<ManagedWindow[]>([]);
  const localScreenIdRef = useRef<string | null>(null);

  // Merge server data into local state: add new windows, remove closed ones,
  // but preserve local layout (position/size/zIndex/state) for windows that
  // already exist locally so debounced optimistic updates aren't overwritten
  // by a stale refetch triggered by other mutations (openWindow/closeWindow).
  useEffect(() => {
    if (!activeScreen) {
      setLocalWindows([]);
      localScreenIdRef.current = null;
      return;
    }

    // Full reset when switching screens — local layout belongs to old screen
    const isScreenSwitch = localScreenIdRef.current !== activeScreenId;
    localScreenIdRef.current = activeScreenId;

    // Shared windows (GMScreen.windows — every GM of the campaign sees them)
    // and the caller's own private windows render through the SAME branch chain
    // below; only their close route and hydration source differ. Close routing
    // keys off which list an id came from (see handleWindowsChange), so the
    // merged entries need no private/shared tag of their own.
    const sources = [...activeScreen.windows, ...privateWindows];

    // Both maps are keyed `collection:documentId`. Private-window docs are
    // hydrated by getPlayerState (which also enforces the per-collection
    // security filter); shared ones come from the screen-detail query.
    const hydratedDocs = { ...activeScreen.hydrated, ...(playerState?.hydrated ?? {}) };

    setLocalWindows((prev) => {
      const prevById = isScreenSwitch
        ? new Map<string, ManagedWindow>()
        : new Map(prev.map((w) => [w.id, w]));
      const sourceIds = new Set(sources.map((w) => w.id));

      const merged = sources.map((w) => {
        const key = `${w.collection}:${w.documentId}`;
        const doc = hydratedDocs[key];
        const title = doc?.title || key;
        const markdownContent = doc?.content || '';

        let windowContent: React.ReactNode;

        if (w.collection === 'character') {
          windowContent = (
            <CharacterWindowWrapper
              characterId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingCharacterId(w.documentId)}
            />
          );
        } else if (w.collection === 'race') {
          windowContent = (
            <RaceWindowWrapper
              raceId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingRaceId(w.documentId)}
            />
          );
        } else if (w.collection === 'rule') {
          windowContent = (
            <RuleWindowWrapper
              ruleId={w.documentId}
              campaignId={campaignId}
              isGM={isGM}
              onEdit={() => setEditingRuleId(w.documentId)}
            />
          );
        } else if (w.collection === 'player') {
          windowContent = (
            <PlayerWindowWrapper
              playerId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingPlayerId(w.documentId)}
            />
          );
        } else if (w.collection === 'location') {
          windowContent = (
            <LocationWindowWrapper
              locationId={w.documentId}
              campaignId={campaignId}
              isGM={isGM}
              onEdit={() => setEditingLocationId(w.documentId)}
              onOpenLocation={(locId) => handleOpenItem('location', locId)}
            />
          );
        } else if (w.collection === 'monster') {
          windowContent = (
            <MonsterWindowWrapper
              monsterId={w.documentId}
              campaignId={campaignId}
              isGM={isGM}
              onEdit={() => setEditingMonsterId(w.documentId)}
            />
          );
        } else if (w.collection === 'lore') {
          windowContent = (
            <LoreWindowWrapper
              loreId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingLoreId(w.documentId)}
            />
          );
        } else if (w.collection === 'organization') {
          windowContent = (
            <OrganizationWindowWrapper
              organizationId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingOrganizationId(w.documentId)}
            />
          );
        } else if (w.collection === 'quest') {
          windowContent = (
            <QuestWindowWrapper
              questId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingQuestId(w.documentId)}
            />
          );
        } else if (w.collection === 'spell') {
          windowContent = (
            <SpellWindowWrapper
              spellId={w.documentId}
              campaignId={campaignId}
              onEdit={() => setEditingSpellId(w.documentId)}
            />
          );
        } else if (w.collection === 'events') {
          windowContent = <EventWindowWrapper eventId={w.documentId} campaignId={campaignId} />;
        } else {
          windowContent = (
            <div className="p-4 overflow-auto h-full">
              <div className={MARKDOWN_PROSE_CLASSES}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
              </div>
            </div>
          );
        }

        let titleIcon: React.ReactNode;
        let titleSuffix: React.ReactNode;
        const iconKey = `${doc?.isPublic ?? 'none'}:${doc?.link ?? ''}`;

        if (
          w.collection === 'rule' ||
          w.collection === 'character' ||
          w.collection === 'location' ||
          w.collection === 'lore' ||
          w.collection === 'organization' ||
          w.collection === 'quest'
        ) {
          if (doc?.isPublic === true) {
            titleIcon = (
              <span aria-label="Public">
                <Globe className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              </span>
            );
          } else if (doc?.isPublic === false) {
            titleIcon = (
              <span aria-label="Private">
                <Lock className="h-3 w-3 text-amber-400" aria-hidden="true" />
              </span>
            );
          }
        }

        if (w.collection === 'character' && doc?.link) {
          titleSuffix = (
            <a
              href={doc.link}
              target="_blank"
              rel="noopener noreferrer"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center"
              aria-label="External link"
            >
              <ExternalLink className="h-3 w-3 text-slate-500 hover:text-blue-400 transition-colors" />
            </a>
          );
        }

        const existing = prevById.get(w.id);
        if (existing) {
          // Preserve local layout, update title/content from server
          return {
            ...existing,
            title,
            titleIcon,
            titleSuffix,
            iconKey,
            contentKey: markdownContent,
            className: flashWindowId === existing.id ? 'animate-flash-border' : '',
            content: windowContent,
          };
        }

        // New window from server — use server layout
        return {
          id: w.id,
          title,
          titleIcon,
          titleSuffix,
          iconKey,
          contentKey: markdownContent,
          position: w.x != null && w.y != null ? { x: w.x, y: w.y } : undefined,
          size:
            w.width != null && w.height != null ? { width: w.width, height: w.height } : undefined,
          state: toFloatingState(w.state),
          zIndex: w.zIndex,
          className: flashWindowId === w.id ? 'animate-flash-border' : '',
          content: windowContent,
        };
      });

      // Only update if the window set or titles changed (avoid unnecessary renders)
      if (
        prev.length === merged.length &&
        prev.every(
          (p, i) =>
            p.id === merged[i]!.id &&
            p.title === merged[i]!.title &&
            p.contentKey === merged[i]!.contentKey &&
            p.iconKey === merged[i]!.iconKey &&
            p.className === merged[i]!.className
        ) &&
        sourceIds.size === prev.length
      ) {
        return prev;
      }

      return merged;
    });
  }, [
    activeScreen,
    activeScreenId,
    flashWindowId,
    campaignId,
    isGM,
    handleOpenItem,
    privateWindows,
    playerState,
  ]);

  // --- Render ---

  if (listLoading) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="gmscreens-loading">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (listError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-slate-400"
        data-testid="gmscreens-error"
      >
        <AlertTriangle className="h-6 w-6 text-red-400" />
        <p className="font-sans text-xs">{listError}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="gmscreens-view">
      <ScreenBar
        screens={screens}
        activeScreenId={activeScreenId}
        onSelectScreen={handleSelectScreen}
        onCreateScreen={() => setDialog({ type: 'create-screen' })}
        onRenameScreen={(id) => {
          const s = screens.find((s) => s.id === id);
          if (s) setDialog({ type: 'rename-screen', screenId: id, currentName: s.name });
        }}
        onDeleteScreen={(id) => {
          const s = screens.find((s) => s.id === id);
          if (s) setDialog({ type: 'delete-screen', screenId: id, screenName: s.name });
        }}
        onReorderScreens={() => setDialog({ type: 'reorder' })}
      />

      {/* Workspace */}
      <div
        ref={workspaceRef}
        id={activeScreenId ? `gmscreen-tabpanel-${activeScreenId}` : 'gmscreen-tabpanel'}
        role="tabpanel"
        aria-labelledby={activeScreenId ? `screen-tab-${activeScreenId}` : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'relative flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_38%),linear-gradient(180deg,#111827_0%,#0D1117_100%)]',
          'transition-shadow duration-200',
          isDragOver ? 'ring-2 ring-inset ring-blue-500/40 bg-blue-500/[0.03]' : '',
        ].join(' ')}
      >
        {detailLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : detailError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <p className="font-sans text-xs">{detailError}</p>
          </div>
        ) : activeScreen ? (
          <>
            {/* Floating windows */}
            <FloatingWindowManager windows={localWindows} onWindowsChange={handleWindowsChange} />

            {/* Desktop stacks — absolutely positioned overlay */}
            <div className="pointer-events-none absolute inset-0 hidden lg:block">
              <div className="pointer-events-auto">
                {activeScreen.stacks.map((stack) => (
                  <StackCard
                    key={stack.id}
                    stack={stack}
                    hydrated={activeScreen.hydrated}
                    onRename={handleRenameStack}
                    onDelete={handleDeleteStack}
                    onRemoveItem={handleRemoveStackItem}
                    onOpenItem={handleOpenItem}
                  />
                ))}
              </div>
            </div>

            {/* Mobile stacks — in-flow scrollable row at the bottom */}
            {activeScreen.stacks.length > 0 && (
              <div className="absolute bottom-14 left-0 right-0 z-30 flex gap-2 overflow-x-auto px-2 py-1 lg:hidden">
                {activeScreen.stacks.map((stack) => (
                  <StackCard
                    key={stack.id}
                    stack={stack}
                    hydrated={activeScreen.hydrated}
                    onRename={handleRenameStack}
                    onDelete={handleDeleteStack}
                    onRemoveItem={handleRemoveStackItem}
                    onOpenItem={handleOpenItem}
                    inFlowLayout
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {localWindows.length === 0 && activeScreen.stacks.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Layers className="h-10 w-10 text-slate-700" />
                <p className="font-sans font-semibold text-xs text-slate-600">
                  This screen is empty
                </p>
                <p className="font-sans text-[10px] text-slate-700">
                  Open documents as windows or create stacks to organize
                </p>
              </div>
            )}
          </>
        ) : screens.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Layers className="h-10 w-10 text-slate-700" />
            <p className="font-sans font-semibold text-xs text-slate-600">No screens yet</p>
            <button
              type="button"
              onClick={() => setDialog({ type: 'create-screen' })}
              className="font-sans text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Create your first screen
            </button>
          </div>
        ) : null}

        {/* FAB for creating stacks */}
        {activeScreenId && (
          <button
            type="button"
            onClick={() => setDialog({ type: 'create-stack' })}
            aria-label="Create stack"
            data-testid="create-stack-fab"
            className="absolute bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-900/40 transition-colors hover:bg-blue-500 active:bg-blue-700 sm:bottom-6 sm:right-6"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>

      <GMScreenDialogs
        dialog={dialog}
        screens={screens}
        onDismiss={() => setDialog({ type: 'none' })}
        onCreateScreen={handleCreateScreen}
        onRenameScreen={handleRenameScreen}
        onDeleteScreen={handleDeleteScreen}
        onReorder={handleReorder}
        onCreateStack={handleCreateStack}
        mutations={mutations}
      />

      {editingCharacterId !== null && (
        <EditCharacterModalWrapper
          campaignId={campaignId}
          characterId={editingCharacterId}
          onClose={() => setEditingCharacterId(null)}
        />
      )}
      {editingRaceId !== null && (
        <EditRaceModalWrapper
          campaignId={campaignId}
          raceId={editingRaceId}
          onClose={() => setEditingRaceId(null)}
        />
      )}
      {editingRuleId !== null && (
        <EditRuleModalWrapper
          campaignId={campaignId}
          ruleId={editingRuleId}
          onClose={() => setEditingRuleId(null)}
        />
      )}
      {editingPlayerId !== null && (
        <EditPlayerModalWrapper
          campaignId={campaignId}
          playerId={editingPlayerId}
          onClose={() => setEditingPlayerId(null)}
        />
      )}
      {editingLocationId !== null && (
        <EditLocationModalWrapper
          campaignId={campaignId}
          locationId={editingLocationId}
          onClose={() => setEditingLocationId(null)}
        />
      )}
      {editingMonsterId !== null && (
        <EditMonsterModalWrapper
          campaignId={campaignId}
          monsterId={editingMonsterId}
          onClose={() => setEditingMonsterId(null)}
        />
      )}
      {editingLoreId !== null && (
        <EditLoreModalWrapper
          campaignId={campaignId}
          loreId={editingLoreId}
          onClose={() => setEditingLoreId(null)}
        />
      )}
      {editingOrganizationId !== null && (
        <EditOrganizationModalWrapper
          campaignId={campaignId}
          organizationId={editingOrganizationId}
          onClose={() => setEditingOrganizationId(null)}
        />
      )}
      {editingQuestId !== null && (
        <EditQuestModalWrapper
          campaignId={campaignId}
          questId={editingQuestId}
          onClose={() => setEditingQuestId(null)}
        />
      )}
      {editingSpellId !== null && (
        <EditSpellModalWrapper
          campaignId={campaignId}
          spellId={editingSpellId}
          onClose={() => setEditingSpellId(null)}
        />
      )}
    </div>
  );
}
