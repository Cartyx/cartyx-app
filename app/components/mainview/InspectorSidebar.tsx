import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';
import { SettingsPanel } from './SettingsPanel';
import { WikiPanel } from '~/components/wiki/WikiPanel';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMessage, faBook, faNoteSticky, faGear, faDice } from '@fortawesome/pro-solid-svg-icons';
import { DicePanel } from './DicePanel';
import { ChevronRight } from 'lucide-react';
import { usePartySession } from '~/hooks/usePartySession';
import { useBeyond20 } from '~/hooks/useBeyond20';
import { useChatMessages } from '~/hooks/useChatMessages';
import { useDiceRolls } from '~/hooks/useDiceRolls';
import { useAuth } from '~/hooks/useAuth';
import { onDiceBroadcastRequest, reportDiceDelivery } from '~/utils/diceRollerBridge';
import { onChatBroadcastRequest, reportChatDelivery } from '~/utils/chatBridge';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const getPartyTokenFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { getPartyToken } = await import('~/server/functions/auth');
    return getPartyToken({ data });
  });

export type InspectorTab = 'chat' | 'dice' | 'wiki' | 'notes' | 'settings';

export interface InspectorSidebarProps {
  defaultTab?: InspectorTab;
  onMobileClose?: () => void;
  campaignId?: string;
  sessions?: Array<{ id: string; name: string; number: number; status: string }>;
}

const ALL_TABS: { id: InspectorTab; icon: IconDefinition; label: string }[] = [
  { id: 'chat', icon: faMessage, label: 'Chat' },
  { id: 'dice', icon: faDice, label: 'Dice' },
  { id: 'wiki', icon: faBook, label: 'Wiki' },
  { id: 'notes', icon: faNoteSticky, label: 'Notes' },
  { id: 'settings', icon: faGear, label: 'Settings' },
];

function tabId(id: InspectorTab) {
  return `inspector-tab-${id}`;
}

function panelId(id: InspectorTab) {
  return `inspector-panel-${id}`;
}

export function InspectorSidebar({
  defaultTab = 'chat',
  onMobileClose,
  campaignId,
  sessions,
}: InspectorSidebarProps) {
  const tabs = ALL_TABS;
  const [activeTab, setActiveTab] = useState<InspectorTab>(defaultTab);
  const tablistRef = useRef<HTMLDivElement>(null);

  // Real-time wiring — only active when campaignId is provided
  const { user } = useAuth();
  const activeSession = (sessions ?? []).find((s) => s.status === 'active');
  const activeSessionId = activeSession?.id ?? '';
  const [viewingSessionId, setViewingSessionId] = useState(activeSessionId);

  // Update viewing session when active session changes
  useEffect(() => {
    if (activeSessionId) setViewingSessionId(activeSessionId);
  }, [activeSessionId]);

  const isViewingActive = viewingSessionId === activeSessionId;
  const effectiveCampaignId = campaignId ?? '';

  const {
    messages,
    sendMessage,
    sendSpellCard,
    handlePartyMessage: handleChatPartyMessage,
    saveError: chatSaveError,
    setSaveError: setChatSaveError,
  } = useChatMessages(viewingSessionId, effectiveCampaignId, isViewingActive);

  const {
    rolls,
    sendDiceRoll,
    handlePartyMessage: handleDicePartyMessage,
    saveError: diceSaveError,
    setSaveError: setDiceSaveError,
  } = useDiceRolls(viewingSessionId, effectiveCampaignId, isViewingActive);

  // Combined realtime message handler
  const handlePartyMessage = useCallback(
    (msg: unknown) => {
      handleChatPartyMessage(msg);
      handleDicePartyMessage(msg);
    },
    [handleChatPartyMessage, handleDicePartyMessage]
  );

  const socket = usePartySession(
    isViewingActive && activeSessionId ? activeSessionId : null,
    async () => {
      if (!activeSessionId) return '';
      const token = await getPartyTokenFn({ data: { sessionId: activeSessionId } });
      return token ?? '';
    },
    handlePartyMessage
  );

  const { isConnected } = useBeyond20(
    (roll) => sendDiceRoll(roll, socket),
    (card) => sendSpellCard(card, user?.id ?? '', user?.name ?? '', socket)
  );

  // Relay interactive dice-roller rolls (DiceRollerPanel → window event) to the
  // session socket, mirroring how Beyond20 extension rolls are relayed above.
  useEffect(() => {
    return onDiceBroadcastRequest(({ requestId, roll }) => {
      const canSend =
        isViewingActive && !!activeSessionId && !!socket && socket.readyState === WebSocket.OPEN;
      if (canSend) {
        sendDiceRoll({ ...roll, character: roll.character || user?.name || 'Player' }, socket);
      }
      reportDiceDelivery({ requestId, delivered: canSend });
    });
  }, [socket, sendDiceRoll, isViewingActive, activeSessionId, user?.name]);

  // Relay "share in chat" requests (e.g. the spell view → window event) to the
  // session socket as a chat message, same gating as dice rolls.
  useEffect(() => {
    return onChatBroadcastRequest(({ requestId, text, channel }) => {
      const canSend =
        isViewingActive && !!activeSessionId && !!socket && socket.readyState === WebSocket.OPEN;
      if (canSend) {
        sendMessage(text, channel, user?.id ?? '', user?.name || 'Player', socket);
      }
      reportChatDelivery({ requestId, delivered: canSend });
    });
  }, [socket, sendMessage, isViewingActive, activeSessionId, user?.id, user?.name]);

  const sessionList = (sessions ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    number: s.number,
  }));

  function handleKeyDown(e: React.KeyboardEvent) {
    if (tabs.length === 0) return;

    const currentIndex = tabs.findIndex((t) => t.id === activeTab);
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    setActiveTab(tabs[nextIndex]!.id);
    const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#0D1117]">
      {/* Tab bar */}
      <div className="flex h-12 border-b border-white/[0.07] flex-shrink-0">
        <div
          className="flex flex-1"
          role="tablist"
          aria-label="Inspector panels"
          ref={tablistRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                id={tabId(tab.id)}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId(tab.id)}
                aria-label={tab.label}
                tabIndex={isActive ? 0 : -1}
                data-testid={tabId(tab.id)}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex flex-1 items-center justify-center text-base transition-colors relative',
                  isActive
                    ? "text-[#60A5FA] after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#60A5FA]"
                    : 'text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                <FontAwesomeIcon icon={tab.icon} className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        {onMobileClose && (
          <button
            type="button"
            aria-label="Close inspector"
            data-testid="mobile-inspector-close"
            onClick={onMobileClose}
            className="lg:hidden flex items-center justify-center w-10 text-slate-400 hover:text-slate-200 border-l border-white/[0.07] transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Tab panels — one per tab, only active is visible */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <div
            key={tab.id}
            id={panelId(tab.id)}
            data-testid={isActive ? 'inspector-panel' : undefined}
            role="tabpanel"
            aria-labelledby={tabId(tab.id)}
            hidden={!isActive}
            className="flex flex-1 min-h-0 w-full"
          >
            {tab.id === 'chat' ? (
              <ChatPanel
                messages={messages}
                onSendMessage={(text, channel) =>
                  sendMessage(text, channel, user?.id ?? '', user?.name ?? '', socket)
                }
                sessions={sessionList}
                activeSessionId={viewingSessionId}
                onSessionChange={setViewingSessionId}
                saveError={chatSaveError}
                onDismissError={() => setChatSaveError(null)}
              />
            ) : tab.id === 'dice' ? (
              <DicePanel
                rolls={rolls}
                isConnected={isConnected}
                sessions={sessionList}
                activeSessionId={viewingSessionId}
                onSessionChange={setViewingSessionId}
                saveError={diceSaveError}
                onDismissError={() => setDiceSaveError(null)}
              />
            ) : tab.id === 'wiki' ? (
              <WikiPanel />
            ) : tab.id === 'notes' ? (
              <NotesPanel />
            ) : tab.id === 'settings' ? (
              <SettingsPanel />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <span className="font-sans font-semibold text-xs text-slate-600">
                  {tab.label} — Coming Soon
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
