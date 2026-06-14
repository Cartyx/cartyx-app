import React, { useState, useCallback, useEffect, useRef, type DragEvent } from 'react';
import { Globe, Lock, ExternalLink } from 'lucide-react';
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
import { useTabletopMapParty } from '~/hooks/useTabletopMapParty';
import {
  applyTokenAddToCache,
  applyTokenMoveToCache,
  applyTokenRemoveFromCache,
  applyTokenUpdateToCache,
} from '~/hooks/useMapTokens';
import { ActiveMapStage } from './ActiveMapStage';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '~/utils/queryKeys';
import { TabletopTabBar } from './TabletopTabBar';
import { TabletopCanvas } from './TabletopCanvas';
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
import type { TabletopMessage } from '~/types/tabletop';
import type { ToolType } from '~/components/mainview/ToolBar';
import type { PingData } from './PingOverlay';

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
}

export function TabletopView({
  campaignId,
  isGM,
  currentUserId,
  getToken,
  sessionId: _sessionId,
  activeTool,
  onToolChange,
}: TabletopViewProps) {
  const { screens, isLoading } = useTabletopScreenList(campaignId);
  const mutations = useTabletopMutations(campaignId);
  const { playerState, updateState } = useTabletopPlayerState(campaignId);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  // Active map is per-tab — render the active map of the tab being viewed.
  const { data: activeMap } = useActiveMap(campaignId, activeScreenId);
  const queryClient = useQueryClient();

  // Map party — keeps every connected client in sync with map/token writes.
  // Active-map changes are broadcast server-side by `setActiveMap`/`deleteMap`
  // (so they fire regardless of which UI triggered the write); this client just
  // reacts by refetching. Token events apply optimistic cache updates so remote
  // clients see drags in realtime.
  const { send: sendMapMessage } = useTabletopMapParty(campaignId, getToken, (msg) => {
    if (msg.type === 'map:active-changed') {
      // Invalidate every tab's active-map query (cheap; only the visible tab refetches).
      queryClient.invalidateQueries({ queryKey: queryKeys.maps.activeAll(campaignId) });
      return;
    }
    if (msg.type === 'token:added') {
      applyTokenAddToCache(queryClient, campaignId, msg.mapId, msg.token);
    } else if (msg.type === 'token:moved') {
      applyTokenMoveToCache(queryClient, campaignId, msg.mapId, msg.tokenId, msg.x, msg.y);
    } else if (msg.type === 'token:removed') {
      applyTokenRemoveFromCache(queryClient, campaignId, msg.mapId, msg.tokenId);
    } else if (msg.type === 'token:updated') {
      applyTokenUpdateToCache(queryClient, campaignId, msg.mapId, msg.token);
    }
  });

  const [badgeScreenIds, setBadgeScreenIds] = useState<Set<string>>(new Set());
  const [_pings, setPings] = useState<PingData[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localWindows, setLocalWindows] = useState<ManagedWindow[]>([]);
  const localScreenIdRef = useRef<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Ref guard to prevent double auto-creation of default screen
  const autoCreatedRef = useRef(false);

  // Initialize active screen from player state or first screen
  useEffect(() => {
    if (activeScreenId) return;
    if (playerState?.activeScreenId) {
      setActiveScreenId(playerState.activeScreenId);
    } else if (screens.length > 0) {
      setActiveScreenId(screens[0].id);
    }
  }, [screens, playerState, activeScreenId]);

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
          mutations.invalidateList();
        }
      })
      .catch(() => {
        // Reset guard so user can retry
        autoCreatedRef.current = false;
      });
  }, [isLoading, isGM, screens.length, mutations]);

  // Fetch detail for active screen
  const { screen: activeScreen } = useTabletopScreenDetail(campaignId, activeScreenId);

  // Handle ping expired (used when PingOverlay is wired in)
  const _handlePingExpired = useCallback((id: string) => {
    setPings((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // PartyKit message handler
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
        case 'ping':
          setPings((prev) => [
            ...prev,
            {
              id: `${msg.userId}-${Date.now()}`,
              x: msg.x,
              y: msg.y,
              userName: msg.userName,
              color: msg.color,
              createdAt: Date.now(),
            },
          ]);
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

    setLocalWindows((prev) => {
      const prevById = isScreenSwitch
        ? new Map<string, ManagedWindow>()
        : new Map(prev.map((w) => [w.id, w]));

      const merged = activeScreen.windows.map((w) => {
        const key = `${w.collection}:${w.documentId}`;
        const doc = activeScreen.hydrated[key];
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
                  mutations.openWindow.mutate({
                    screenId: activeScreenId,
                    collection: 'location',
                    documentId: locId,
                  });
                }
              }}
            />
          );
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
          w.collection === 'location'
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
            p.iconKey === merged[i]!.iconKey
        )
      ) {
        return prev;
      }

      return merged;
    });
  }, [activeScreen, activeScreenId, campaignId, isGM]);

  // --- Window change handler (local state + close mutation) ---
  const handleWindowsChange = useCallback(
    (nextWindows: ManagedWindow[]) => {
      // Optimistically update local state immediately (handles minimize/restore/move/resize)
      setLocalWindows(nextWindows);

      if (!activeScreenId || !activeScreen) return;

      // Handle closes — fire close mutation for removed windows
      const nextIds = new Set(nextWindows.map((w) => w.id));
      for (const w of activeScreen.windows) {
        if (!nextIds.has(w.id)) {
          mutations.closeWindow.mutate({ screenId: activeScreenId, windowId: w.id });
        }
      }
    },
    [activeScreenId, activeScreen, mutations]
  );

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
        // Already open — no flash/focus needed in Phase 1
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
    [activeScreenId, activeScreen, mutations]
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
            layerPanelOpen={activeTool === 'layer'}
            onCloseLayerPanel={() => onToolChange?.('pointer')}
          />
        ) : (
          <TabletopCanvas screen={activeScreen} />
        )}

        <FloatingWindowManager windows={localWindows} onWindowsChange={handleWindowsChange} />
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
