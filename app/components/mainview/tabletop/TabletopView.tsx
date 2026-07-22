import React, { useState, useCallback, useEffect, useMemo, useRef, type DragEvent } from 'react';
import { Globe, Lock, ExternalLink, Dices } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useTabletopScreenList,
  useTabletopScreenDetail,
  useTabletopMutations,
} from '~/hooks/useTabletopScreens';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import { useTabletopParty } from '~/hooks/useTabletopParty';
import { useActiveMap } from '~/hooks/useMaps';
import { useTabletopMapSync } from '~/hooks/useTabletopMapSync';
import { ActiveMapStage } from './ActiveMapStage';
import { TabletopTabBar } from './TabletopTabBar';
import { TabletopCanvas } from './TabletopCanvas';
import { DiceRollerPanel } from '~/components/mainview/DiceRollerPanel';
import {
  FloatingWindowManager,
  type ManagedWindow,
} from '~/components/mainview/FloatingWindowManager';
import type { FloatingWindowState } from '~/components/mainview/FloatingWindow';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import {
  CharacterWindowWrapper,
  EditCharacterModalWrapper,
} from '~/components/mainview/gmscreens/CharacterWindowWrapper';
import {
  LoreWindowWrapper,
  EditLoreModalWrapper,
} from '~/components/mainview/gmscreens/LoreWindowWrapper';
import {
  OrganizationWindowWrapper,
  EditOrganizationModalWrapper,
} from '~/components/wiki/organizations/OrganizationWindowWrapper';
import {
  QuestWindowWrapper,
  EditQuestModalWrapper,
} from '~/components/wiki/quests/QuestWindowWrapper';
import { EventWindowWrapper } from '~/components/mainview/gmscreens/EventWindowWrapper';
import { RaceWindowWrapper, EditRaceModalWrapper } from '~/components/wiki/races/RaceWindowWrapper';
import {
  RuleWindowWrapper,
  EditRuleModalWrapper,
} from '~/components/mainview/gmscreens/RuleWindowWrapper';
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
import type { TabletopMessage } from '~/types/tabletop';
import type { ToolType } from '~/components/mainview/ToolBar';
import { ToolWindow } from './ToolWindow';
import { TOOL_WINDOW_META, type ToolWindowId } from './toolWindowState';
import { useToolWindows } from './useToolWindows';

// ---------------------------------------------------------------------------
// Dialog state (mirrors GMScreenDialogs pattern)
// ---------------------------------------------------------------------------

type DialogState =
  | { type: 'none' }
  | { type: 'create-tab' }
  | { type: 'rename-tab'; screenId: string; currentName: string }
  | { type: 'delete-tab'; screenId: string; screenName: string };

/** Map FloatingWindow states to backend WindowState values (used when server persistence is added). */
function _toWindowState(state: FloatingWindowState): 'open' | 'minimized' {
  if (state === 'minimized') return 'minimized';
  return 'open';
}

/** Map backend WindowState to FloatingWindow states. */
function toFloatingState(state: string): FloatingWindowState {
  if (state === 'minimized') return 'minimized';
  return 'normal';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TabletopViewProps {
  campaignId: string;
  isGM: boolean;
  currentUserId: string | null;
  getToken: () => Promise<string>;
  sessionId: string | null;
  /** Active toolbar tool (owned by the play route). */
  activeTool?: ToolType;
  onToolChange?: (tool: ToolType) => void;
  /** Open tool windows (owned by the play route). */
  openToolWindows: ToolWindowId[];
  /** Close a tool window (X button) — routes through the play route's reducer. */
  onCloseToolWindow: (id: ToolWindowId) => void;
}

export function TabletopView({
  campaignId,
  isGM,
  currentUserId,
  getToken,
  sessionId: _sessionId,
  activeTool,
  // No longer read here — the dice special-case (the only caller) is gone;
  // kept as a prop for API parity with the play route's toolUi reducer.
  onToolChange: _onToolChange,
  openToolWindows,
  onCloseToolWindow,
}: TabletopViewProps) {
  const { screens, isLoading } = useTabletopScreenList(campaignId);
  const mutations = useTabletopMutations(campaignId);
  const openWindow = mutations.openWindow.mutate;
  const {
    playerState,
    isLoading: playerStateLoading,
    updateState,
    removePrivateWindow,
  } = useTabletopPlayerState(campaignId);
  const removePrivateWindowMutate = removePrivateWindow.mutate;
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  // Active map is per-tab — render the active map of the tab being viewed.
  const { data: activeMap } = useActiveMap(campaignId, activeScreenId);

  // Map party — keeps every connected client in sync with map/token/text/drawing
  // writes by applying inbound messages to the query cache. Returns `send` for
  // broadcasting this client's local changes.
  const sendMapMessage = useTabletopMapSync(campaignId, getToken, isGM);

  const [badgeScreenIds, setBadgeScreenIds] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
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
  const [localWindows, setLocalWindows] = useState<ManagedWindow[]>([]);
  const [flashWindowId, setFlashWindowId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localScreenIdRef = useRef<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // The caller's own private windows for this tab. These live on player state,
  // are never broadcast, and only ever render for their owner.
  const privateWindows = useMemo(
    () =>
      (playerState?.privateWindows ?? []).filter(
        (pw) => pw.surface === 'tabletop' && pw.screenId === activeScreenId
      ),
    [playerState, activeScreenId]
  );

  // Focus + flash an already-open window (shared or private). Mirrors the
  // GM-screens flash (flag the id, clear it after 700ms), but raises z-index
  // locally: unlike gmscreens, tabletop has no updateWindow mutation, and a
  // private window's layout is the owner's own business anyway.
  const focusWindow = useCallback((windowId: string) => {
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

    setFlashWindowId(windowId);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlashWindowId(null);
    }, 700);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Per-user tool windows (Draw/Text/Ruler/Dice/Layers) — geometry only; the
  // open set lives in the play route. Dice renders here (works without an
  // active map); the map-tool windows render inside ActiveMapStage.
  const toolWindowManager = useToolWindows(openToolWindows, workspaceRef, onCloseToolWindow);

  // Ref guard to prevent double auto-creation of default screen
  const autoCreatedRef = useRef(false);

  // Collision-safe primitive key that tracks the *set* of screen IDs. Sorted so
  // harmless order changes (reorder, refetch jitter) don't trigger re-runs —
  // only actual additions/removals change this value.
  const screenIdsKey = useMemo(
    () => JSON.stringify([...screens.map((s) => s.id)].sort()),
    [screens]
  );

  // Ref to current ordered screens so the seeding effect can pick the first
  // screen by tab-order without adding `screens` to its dep array.
  const screensRef = useRef(screens);
  screensRef.current = screens;

  // Ref to the persisted screen id so the seeding effect can read it without
  // re-running every time our own persist call round-trips.
  const restoredScreenIdRef = useRef<string | null>(null);
  restoredScreenIdRef.current = playerState?.activeScreenId ?? null;

  // Whether the one-time restore from player state has already happened.
  const hasSeededRef = useRef(false);

  // TabletopView isn't remounted on a campaignId change (no `key` at the call
  // site, and TanStack Router v1 doesn't remount on a path-param change), so
  // hasSeededRef must be reset by hand when the campaign switches — otherwise
  // campaign B's first pass sees hasSeededRef already true and falls back to
  // screens[0] instead of restoring ITS persisted screen. Comparing-during-
  // render (not in an effect) ensures the reset lands before the seeding effect.
  const prevCampaignIdRef = useRef(campaignId);
  if (prevCampaignIdRef.current !== campaignId) {
    prevCampaignIdRef.current = campaignId;
    hasSeededRef.current = false;
  }

  // Initialize active screen from player state or first screen. Fires only when
  // the SET of ids changes (screenIdsKey is primitive), and uses a functional
  // update so a persisted-but-DELETED id can never strand the view on a dead
  // screen. Only the first pass reads player state (to restore the last tab);
  // afterwards player state is ignored here and only written to on user action.
  useEffect(() => {
    if (isLoading) return;
    const current = screensRef.current;
    if (current.length === 0) {
      setActiveScreenId(null);
      return;
    }
    // Only the initial seed waits on player state; later list changes must not.
    if (!hasSeededRef.current && playerStateLoading) return;

    const idSet = new Set(current.map((s) => s.id));
    // Restore the last screen. Falls back to the first screen on first visit
    // (activeScreenId is null until picked) and when the persisted screen has
    // since been deleted (not present in idSet).
    const restored = hasSeededRef.current ? null : restoredScreenIdRef.current;
    hasSeededRef.current = true;
    const fallback = restored && idSet.has(restored) ? restored : current[0]!.id;

    setActiveScreenId((prev) => (prev && idSet.has(prev) ? prev : fallback));
  }, [screenIdsKey, isLoading, playerStateLoading]);

  // Auto-create default screen when list is empty and user is GM
  useEffect(() => {
    if (isLoading) return;
    if (!isGM) return;
    if (screens.length > 0) return;
    if (autoCreatedRef.current) return;

    autoCreatedRef.current = true;
    mutations.createScreen
      .mutateAsync('Default')
      .then((result) => {
        if (result?.success) {
          setActiveScreenId(result.screen.id);
          // Persist the selection so the Maps panel (which reads the saved
          // player-state, not this local state) targets the new tab.
          updateState.mutate({ activeScreenId: result.screen.id });
          mutations.invalidateList();
        }
      })
      .catch(() => {
        // Reset guard so user can retry
        autoCreatedRef.current = false;
      });
  }, [isLoading, isGM, screens.length, mutations, updateState]);

  // Fetch detail for active screen
  const { screen: activeScreen } = useTabletopScreenDetail(campaignId, activeScreenId);

  // Realtime message handler
  const handleMessage = useCallback(
    (msg: TabletopMessage) => {
      switch (msg.type) {
        case 'tab:create':
          mutations.invalidateList();
          break;
        case 'tab:rename':
        case 'tab:delete':
          mutations.invalidateList();
          break;
        case 'tab:focus-all':
          setActiveScreenId(msg.screenId);
          break;
        case 'tab:content-added':
          if (msg.screenId !== activeScreenId) {
            setBadgeScreenIds((prev) => new Set([...prev, msg.screenId]));
          }
          break;
        case 'window:show':
        case 'window:close':
          if (msg.screenId === activeScreenId) {
            mutations.invalidateDetail(msg.screenId);
          }
          break;
        case 'grid:style-change':
          if (msg.screenId === activeScreenId) {
            mutations.invalidateDetail(msg.screenId);
          }
          break;
      }
    },
    [activeScreenId, mutations]
  );

  const { send } = useTabletopParty(campaignId, getToken, handleMessage);

  // Handle tab change
  const handleScreenChange = (screenId: string) => {
    setActiveScreenId(screenId);
    setBadgeScreenIds((prev) => {
      const next = new Set(prev);
      next.delete(screenId);
      return next;
    });
    updateState.mutate({ activeScreenId: screenId });
  };

  // Handle create screen (via dialog)
  const handleCreateScreen = async (name: string) => {
    const result = await mutations.createScreen.mutateAsync(name);
    if (result.success) {
      await mutations.invalidateList();
      setActiveScreenId(result.screen.id);
      // Persist the selection so the Maps panel (which reads the saved
      // player-state, not this local state) targets the new tab.
      updateState.mutate({ activeScreenId: result.screen.id });
      send({ type: 'tab:create', screen: result.screen });
    }
    setDialog({ type: 'none' });
  };

  // Handle rename screen (via dialog)
  const handleRenameScreen = async (name: string) => {
    if (dialog.type !== 'rename-tab') return;
    await mutations.renameScreen.mutateAsync({ id: dialog.screenId, name });
    send({ type: 'tab:rename', screenId: dialog.screenId, name });
    setDialog({ type: 'none' });
  };

  // Handle delete screen (via dialog)
  const handleDeleteScreen = async () => {
    if (dialog.type !== 'delete-tab') return;
    const deletingId = dialog.screenId;
    const idx = screens.findIndex((s) => s.id === deletingId);
    const nextScreen = screens[idx + 1] ?? screens[idx - 1] ?? null;
    setActiveScreenId(nextScreen?.id ?? null);
    // Persist the new selection so the wiki's card Push / Show-on-Tab and the
    // Maps panel (which read the SAVED activeScreenId, not this local state)
    // stop pointing at the just-deleted screen.
    updateState.mutate({ activeScreenId: nextScreen?.id ?? null });

    await mutations.deleteScreen.mutateAsync(deletingId);
    mutations.invalidateList();
    send({ type: 'tab:delete', screenId: deletingId });
    setDialog({ type: 'none' });
  };

  // Handle focus all
  const handleFocusAll = () => {
    if (activeScreenId) {
      send({ type: 'tab:focus-all', screenId: activeScreenId });
    }
  };

  // --- Local window state (optimistic) ---
  // Initialized from server, updated optimistically on user interaction,
  // re-synced when server data changes (e.g. after openWindow/closeWindow invalidation).
  useEffect(() => {
    if (!activeScreen) {
      setLocalWindows([]);
      localScreenIdRef.current = null;
      return;
    }

    // Full reset when switching screens
    const isScreenSwitch = localScreenIdRef.current !== activeScreenId;
    localScreenIdRef.current = activeScreenId;

    // Shared windows (TabletopScreen.windows — everyone sees them) and the
    // caller's private windows render through the SAME branch chain below;
    // only their close route and hydration source differ. Close routing keys
    // off which list an id came from (see handleWindowsChange), so the merged
    // entries need no private/shared tag of their own.
    const sources = [...activeScreen.windows, ...privateWindows];

    // Both maps are keyed `collection:documentId`; private-window docs come
    // from the player-state query, shared ones from the screen-detail query.
    const hydratedDocs = { ...activeScreen.hydrated, ...(playerState?.hydrated ?? {}) };

    setLocalWindows((prev) => {
      const prevById = isScreenSwitch
        ? new Map<string, ManagedWindow>()
        : new Map(prev.map((w) => [w.id, w]));

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
              onOpenLocation={(locId) => {
                if (activeScreenId) {
                  openWindow({
                    screenId: activeScreenId,
                    collection: 'location',
                    documentId: locId,
                  });
                }
              }}
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
        )
      ) {
        return prev;
      }

      return merged;
    });
  }, [
    activeScreen,
    activeScreenId,
    campaignId,
    isGM,
    openWindow,
    privateWindows,
    playerState,
    flashWindowId,
  ]);

  // --- Window change handler (local state + close mutation) ---
  const handleWindowsChange = useCallback(
    (nextWindows: ManagedWindow[]) => {
      setLocalWindows(nextWindows);
      const nextIds = new Set(nextWindows.map((w) => w.id));

      // Route each disappeared window by the list it came from. A private
      // window must NOT go through closeWindow: that mutation is GM-only (a
      // player would silently get Forbidden) and it closes the SHARED window
      // for the whole campaign.
      for (const pw of privateWindows) {
        if (!nextIds.has(pw.id)) {
          removePrivateWindowMutate({ privateWindowId: pw.id });
        }
      }

      if (!activeScreenId || !activeScreen) return;
      for (const w of activeScreen.windows) {
        if (!nextIds.has(w.id)) {
          mutations.closeWindow.mutate({ screenId: activeScreenId, windowId: w.id });
        }
      }
    },
    [activeScreenId, activeScreen, mutations, privateWindows, removePrivateWindowMutate]
  );

  // --- Focus requests from the wiki ("Show on Tab" on an already-open item) ---
  // The event carries no screenId, so match on collection+documentId within the
  // active screen, across both shared and private windows.
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
      if (!detail || detail.surface !== 'tabletop' || detail.campaignId !== campaignId) return;

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

  // --- Drag-and-drop handlers ---
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

      // Check for duplicate — don't open a second window for the same document
      const existing = activeScreen.windows.find(
        (w) => w.collection === payload.collection && w.documentId === payload.documentId
      );

      if (existing) {
        // Already shared on this tab — focus + flash it rather than opening a
        // duplicate, converging with the GM-screens drop behaviour.
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="tabletop-view">
        <p className="text-xs text-slate-500">Loading tabletop...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="tabletop-view">
      <TabletopTabBar
        screens={screens}
        activeScreenId={activeScreenId}
        onSelectScreen={handleScreenChange}
        onCreateScreen={() => setDialog({ type: 'create-tab' })}
        onRenameScreen={(id) => {
          const s = screens.find((s) => s.id === id);
          if (s) setDialog({ type: 'rename-tab', screenId: id, currentName: s.name });
        }}
        onDeleteScreen={(id) => {
          const s = screens.find((s) => s.id === id);
          if (s) setDialog({ type: 'delete-tab', screenId: id, screenName: s.name });
        }}
        onFocusAll={handleFocusAll}
        isGM={isGM}
        badgeScreenIds={badgeScreenIds}
      />

      <div
        ref={workspaceRef}
        data-testid="tabletop-workspace"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'relative flex-1 overflow-hidden',
          'transition-shadow duration-200',
          isDragOver ? 'ring-2 ring-inset ring-blue-500/40 bg-blue-500/[0.03]' : '',
        ].join(' ')}
      >
        {activeMap ? (
          <ActiveMapStage
            map={activeMap}
            campaignId={campaignId}
            isGM={isGM}
            currentUserId={currentUserId}
            onBroadcast={sendMapMessage}
            rulerActive={activeTool === 'ruler'}
            aoeActive={activeTool === 'aoe'}
            textActive={activeTool === 'text'}
            drawingActive={activeTool === 'drawing'}
            pointerActive={activeTool === 'pointer'}
            handActive={activeTool === 'hand'}
            openToolWindows={openToolWindows}
            windowManager={toolWindowManager}
          />
        ) : (
          <TabletopCanvas screen={activeScreen} />
        )}

        <FloatingWindowManager windows={localWindows} onWindowsChange={handleWindowsChange} />

        {openToolWindows.includes('dice') && (
          <ToolWindow
            title={TOOL_WINDOW_META.dice.title}
            icon={Dices}
            {...toolWindowManager.getWindowProps('dice')}
          >
            <div className="h-[560px] w-[340px]">
              <DiceRollerPanel />
            </div>
          </ToolWindow>
        )}
      </div>

      {/* Dialogs */}
      {dialog.type === 'create-tab' && (
        <TabletopDialog
          title="New Tab"
          placeholder="Tab name"
          defaultValue=""
          confirmLabel="Create"
          onConfirm={handleCreateScreen}
          onDismiss={() => setDialog({ type: 'none' })}
        />
      )}
      {dialog.type === 'rename-tab' && (
        <TabletopDialog
          title="Rename Tab"
          placeholder="Tab name"
          defaultValue={dialog.currentName}
          confirmLabel="Rename"
          onConfirm={handleRenameScreen}
          onDismiss={() => setDialog({ type: 'none' })}
        />
      )}
      {dialog.type === 'delete-tab' && (
        <TabletopConfirmDialog
          title="Delete Tab"
          message={`Are you sure you want to delete "${dialog.screenName}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteScreen}
          onDismiss={() => setDialog({ type: 'none' })}
        />
      )}

      {/* Editing modals */}
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

// ---------------------------------------------------------------------------
// Simple inline dialogs
// ---------------------------------------------------------------------------

interface TabletopDialogProps {
  title: string;
  placeholder: string;
  defaultValue: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onDismiss: () => void;
}

function TabletopDialog({
  title,
  placeholder,
  defaultValue,
  confirmLabel,
  onConfirm,
  onDismiss,
}: TabletopDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-lg border border-white/[0.07] bg-[#0D1117] p-4 shadow-xl">
        <h2 className="font-sans text-sm font-semibold text-slate-200 mb-3">{title}</h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded border border-white/10 bg-[#161B22] px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TabletopConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

function TabletopConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onDismiss,
}: TabletopConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-lg border border-white/[0.07] bg-[#0D1117] p-4 shadow-xl">
        <h2 className="font-sans text-sm font-semibold text-slate-200 mb-2">{title}</h2>
        <p className="font-sans text-xs text-slate-400 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
