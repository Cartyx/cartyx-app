import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorSidebar } from '~/components/mainview/InspectorSidebar';
import { useDiceRolls } from '~/hooks/useDiceRolls';
import { usePartySession } from '~/hooks/usePartySession';
import { requestDiceBroadcast, onDiceDelivery } from '~/utils/diceRollerBridge';

// Env var names used per-environment (set in Vercel)
const { DEV_FLAGS, enabledFlags } = vi.hoisted(() => {
  const DEV_FLAGS = {
    chat: 'dev-inspector-chat',
    dice: 'dev-inspector-dice',
    wiki: 'dev-inspector-wiki',
    notes: 'dev-inspector-notes',
    settings: 'dev-inspector-settings',
  };

  // Which flags are enabled
  const enabledFlags = new Set<string>([
    DEV_FLAGS.chat,
    DEV_FLAGS.dice,
    DEV_FLAGS.wiki,
    DEV_FLAGS.notes,
    DEV_FLAGS.settings,
  ]);

  return { DEV_FLAGS, enabledFlags };
});
let isLoadingFlags = false;

vi.mock('~/utils/featureFlags', () => ({
  useOptionalFeatureFlag: (flag: string) => ({
    isEnabled: Boolean(flag) && enabledFlags.has(flag) && !isLoadingFlags,
    isLoading: isLoadingFlags && Boolean(flag),
  }),
}));

// WikiPanel internally uses tanstack-router's useParams + the campaign hook
// to decide whether to show the GM-only Monsters category. Mock it out so
// these tests don't need a router context.
vi.mock('~/components/wiki/WikiPanel', () => ({
  WikiPanel: () => <div data-testid="wiki-panel" />,
}));

vi.mock('~/components/mainview/NotesPanel', () => ({
  NotesPanel: () => (
    <div data-testid="notes-panel">
      <h2>Notes</h2>
    </div>
  ),
}));

vi.mock('~/components/mainview/SettingsPanel', () => ({
  SettingsPanel: () => (
    <div data-testid="settings-panel">
      <h2>Settings</h2>
    </div>
  ),
}));

vi.mock('~/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ user: { id: 'u1', name: 'Test' } })),
}));

vi.mock('~/hooks/useChatMessages', () => ({
  useChatMessages: vi.fn(() => ({
    messages: [],
    sendMessage: vi.fn(),
    sendSpellCard: vi.fn(),
    handlePartyMessage: vi.fn(),
    saveError: null,
    setSaveError: vi.fn(),
  })),
}));

vi.mock('~/hooks/useDiceRolls', () => ({
  useDiceRolls: vi.fn(() => ({
    rolls: [],
    sendDiceRoll: vi.fn(),
    handlePartyMessage: vi.fn(),
    saveError: null,
    setSaveError: vi.fn(),
  })),
}));

vi.mock('~/hooks/usePartySession', () => ({
  usePartySession: vi.fn(() => null),
}));

vi.mock('~/hooks/useBeyond20', () => ({
  useBeyond20: vi.fn(() => ({ isConnected: false })),
}));

beforeEach(() => {
  isLoadingFlags = false;
  vi.stubEnv('VITE_PUBLIC_FF_CHAT', DEV_FLAGS.chat);
  vi.stubEnv('VITE_PUBLIC_FF_DICE', DEV_FLAGS.dice);
  vi.stubEnv('VITE_PUBLIC_FF_WIKI', DEV_FLAGS.wiki);
  vi.stubEnv('VITE_PUBLIC_FF_NOTES', DEV_FLAGS.notes);
  vi.stubEnv('VITE_PUBLIC_FF_SETTINGS', DEV_FLAGS.settings);
  enabledFlags.add(DEV_FLAGS.chat);
  enabledFlags.add(DEV_FLAGS.dice);
  enabledFlags.add(DEV_FLAGS.wiki);
  enabledFlags.add(DEV_FLAGS.notes);
  enabledFlags.add(DEV_FLAGS.settings);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('InspectorSidebar', () => {
  it('defaults to the chat tab', () => {
    render(<InspectorSidebar />);
    expect(screen.getByTestId('inspector-panel')).toContainElement(
      screen.getByRole('combobox', { name: 'Session selector' })
    );
  });

  it('renders all 5 tab buttons when all flags are enabled', () => {
    render(<InspectorSidebar />);
    expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-tab-dice')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-tab-wiki')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-tab-notes')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-tab-settings')).toBeInTheDocument();
  });

  it('switches to wiki panel when wiki tab is clicked', async () => {
    const user = userEvent.setup();
    render(<InspectorSidebar />);
    await user.click(screen.getByTestId('inspector-tab-wiki'));
    expect(screen.getByTestId('inspector-panel')).toContainElement(
      screen.getByTestId('wiki-panel')
    );
  });

  it('switches to notes panel when notes tab is clicked', async () => {
    const user = userEvent.setup();
    render(<InspectorSidebar />);
    await user.click(screen.getByTestId('inspector-tab-notes'));
    expect(screen.getByTestId('inspector-panel')).toContainElement(
      screen.getByTestId('notes-panel')
    );
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  });

  it('switches to settings panel when settings tab is clicked', async () => {
    const user = userEvent.setup();
    render(<InspectorSidebar />);
    await user.click(screen.getByTestId('inspector-tab-settings'));
    expect(screen.getByTestId('inspector-panel')).toContainElement(
      screen.getByTestId('settings-panel')
    );
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('respects defaultTab prop', () => {
    render(<InspectorSidebar defaultTab="notes" />);
    expect(screen.getByTestId('inspector-panel')).toContainElement(
      screen.getByTestId('notes-panel')
    );
  });

  it('active tab has aria-selected=true', () => {
    render(<InspectorSidebar defaultTab="chat" />);
    expect(screen.getByTestId('inspector-tab-chat')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inspector-tab-wiki')).toHaveAttribute('aria-selected', 'false');
  });

  it('only active tab is tabbable (roving tabindex)', () => {
    render(<InspectorSidebar defaultTab="chat" />);
    expect(screen.getByTestId('inspector-tab-chat')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('inspector-tab-wiki')).toHaveAttribute('tabindex', '-1');
  });

  it('has proper tablist role', () => {
    render(<InspectorSidebar />);
    expect(screen.getByRole('tablist', { name: 'Inspector panels' })).toBeInTheDocument();
  });

  it('arrow keys navigate between tabs', () => {
    render(<InspectorSidebar defaultTab="chat" />);
    const chatTab = screen.getByTestId('inspector-tab-chat');
    fireEvent.keyDown(chatTab, { key: 'ArrowRight' });
    // After chat, the next tab is dice
    expect(screen.getByTestId('inspector-tab-dice')).toHaveAttribute('aria-selected', 'true');
  });

  it('handleKeyDown does nothing when no tabs are available', () => {
    enabledFlags.clear();
    render(<InspectorSidebar />);
    const tablist = screen.getByRole('tablist');
    // Should not throw
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
  });

  it('tab buttons have type=button', () => {
    render(<InspectorSidebar />);
    const buttons = screen.getAllByRole('tab');
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('type', 'button');
    });
  });

  describe('feature flags', () => {
    it('hides chat tab when VITE_PUBLIC_FF_CHAT env var is not set', () => {
      vi.stubEnv('VITE_PUBLIC_FF_CHAT', '');
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-chat')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-wiki')).toBeInTheDocument();
    });

    it('hides wiki tab when VITE_PUBLIC_FF_WIKI env var is not set', () => {
      vi.stubEnv('VITE_PUBLIC_FF_WIKI', '');
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-wiki')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    });

    it('hides notes tab when VITE_PUBLIC_FF_NOTES env var is not set', () => {
      vi.stubEnv('VITE_PUBLIC_FF_NOTES', '');
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-notes')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    });

    it('hides settings tab when VITE_PUBLIC_FF_SETTINGS env var is not set', () => {
      vi.stubEnv('VITE_PUBLIC_FF_SETTINGS', '');
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-settings')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    });

    it('hides chat tab when the feature flag is disabled', () => {
      enabledFlags.delete(DEV_FLAGS.chat);
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-chat')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-wiki')).toBeInTheDocument();
    });

    it('hides wiki tab when the feature flag is disabled', () => {
      enabledFlags.delete(DEV_FLAGS.wiki);
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-wiki')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    });

    it('hides notes tab when the feature flag is disabled', () => {
      enabledFlags.delete(DEV_FLAGS.notes);
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-notes')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    });

    it('hides settings tab when the feature flag is disabled', () => {
      enabledFlags.delete(DEV_FLAGS.settings);
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('inspector-tab-settings')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toBeInTheDocument();
    });

    it('falls back to chat when defaultTab is wiki and wiki flag is disabled', () => {
      enabledFlags.delete(DEV_FLAGS.wiki);
      render(<InspectorSidebar defaultTab="wiki" />);
      expect(screen.getByTestId('inspector-panel')).toContainElement(
        screen.getByRole('combobox', { name: 'Session selector' })
      );
    });

    it('shows loading state when all flagged tabs are loading and none are available yet', () => {
      isLoadingFlags = true;
      enabledFlags.clear();
      render(<InspectorSidebar />);
      expect(screen.getByText('Loading panels...')).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('shows "No panels available" when all flagged tabs are disabled and not loading', () => {
      enabledFlags.clear();
      render(<InspectorSidebar />);
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByText('Loading panels...')).not.toBeInTheDocument();
      expect(screen.getByText('No panels available')).toBeInTheDocument();
    });

    it('switches active panel to chat when the active tab flag (wiki) is toggled off at runtime', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<InspectorSidebar defaultTab="wiki" />);

      // Wiki tab is active on first render
      await user.click(screen.getByTestId('inspector-tab-wiki'));
      expect(screen.getByTestId('inspector-tab-wiki')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('inspector-panel')).toContainElement(
        screen.getByTestId('wiki-panel')
      );

      // Simulate toggling the wiki flag off
      enabledFlags.delete(DEV_FLAGS.wiki);
      rerender(<InspectorSidebar defaultTab="wiki" />);

      // Wiki tab should disappear and chat panel should now be active
      expect(screen.queryByTestId('inspector-tab-wiki')).not.toBeInTheDocument();
      expect(screen.getByTestId('inspector-tab-chat')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('inspector-panel')).toContainElement(
        screen.getByRole('combobox', { name: 'Session selector' })
      );
    });

    it('restores default tab when it becomes available after initial render', async () => {
      // 1. Initial render with wiki flag disabled, but defaultTab="wiki"
      enabledFlags.delete(DEV_FLAGS.wiki);
      const { rerender } = render(<InspectorSidebar defaultTab="wiki" />);

      // It should fall back to chat
      expect(screen.getByTestId('inspector-tab-chat')).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByTestId('inspector-tab-wiki')).not.toBeInTheDocument();

      // 2. Simulate flags finishing loading (wiki flag enabled)
      enabledFlags.add(DEV_FLAGS.wiki);
      rerender(<InspectorSidebar defaultTab="wiki" />);

      // It should now restore wiki as the active tab
      expect(screen.getByTestId('inspector-tab-wiki')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('inspector-panel')).toContainElement(
        screen.getByTestId('wiki-panel')
      );
    });
  });

  describe('mobile close button', () => {
    it('does not render close button when onMobileClose is not provided', () => {
      render(<InspectorSidebar />);
      expect(screen.queryByTestId('mobile-inspector-close')).not.toBeInTheDocument();
    });

    it('renders close button when onMobileClose is provided', () => {
      render(<InspectorSidebar onMobileClose={() => {}} />);
      expect(screen.getByTestId('mobile-inspector-close')).toBeInTheDocument();
    });

    it('close button has aria-label "Close inspector"', () => {
      render(<InspectorSidebar onMobileClose={() => {}} />);
      expect(screen.getByRole('button', { name: 'Close inspector' })).toBeInTheDocument();
    });

    it('calls onMobileClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onMobileClose = vi.fn();
      render(<InspectorSidebar onMobileClose={onMobileClose} />);
      await user.click(screen.getByTestId('mobile-inspector-close'));
      expect(onMobileClose).toHaveBeenCalledOnce();
    });

    it('close button has type=button', () => {
      render(<InspectorSidebar onMobileClose={() => {}} />);
      expect(screen.getByTestId('mobile-inspector-close')).toHaveAttribute('type', 'button');
    });
  });
});

describe('dice roller broadcast relay', () => {
  const activeSessions = [{ id: 'sess-1', name: 'One', number: 1, status: 'active' as const }];
  const parsedRoll = {
    character: '',
    title: '1d20',
    rollType: 'custom',
    attackRolls: [
      { roll: 11, type: 'hit' as const, total: 11, formula: '1d20', discarded: false, dice: [11] },
    ],
    damageRolls: [],
    totalDamages: {},
    rollInfo: [] as Array<[string, string]>,
    description: '',
    channel: 'general' as const,
  };

  it('relays public rolls to sendDiceRoll with the user name and reports delivery', () => {
    const sendDiceRoll = vi.fn();
    vi.mocked(useDiceRolls).mockReturnValue({
      rolls: [],
      sendDiceRoll,
      handlePartyMessage: vi.fn(),
      saveError: null,
      setSaveError: vi.fn(),
    });
    const fakeSocket = { send: vi.fn(), readyState: WebSocket.OPEN };
    vi.mocked(usePartySession).mockReturnValue(fakeSocket as never);

    const deliveries: Array<{ requestId: string; delivered: boolean }> = [];
    const unsubscribe = onDiceDelivery((d) => deliveries.push(d));

    render(<InspectorSidebar campaignId="c1" sessions={activeSessions} />);
    act(() => {
      requestDiceBroadcast({ requestId: 'req-1', roll: parsedRoll });
    });

    expect(sendDiceRoll).toHaveBeenCalledExactlyOnceWith(
      { ...parsedRoll, character: 'Test' },
      fakeSocket
    );
    expect(deliveries).toEqual([{ requestId: 'req-1', delivered: true }]);
    unsubscribe();
  });

  it('reports delivered=false without sending when the socket is not open', () => {
    const sendDiceRoll = vi.fn();
    vi.mocked(useDiceRolls).mockReturnValue({
      rolls: [],
      sendDiceRoll,
      handlePartyMessage: vi.fn(),
      saveError: null,
      setSaveError: vi.fn(),
    });
    vi.mocked(usePartySession).mockReturnValue(null as never);

    const deliveries: Array<{ requestId: string; delivered: boolean }> = [];
    const unsubscribe = onDiceDelivery((d) => deliveries.push(d));

    render(<InspectorSidebar campaignId="c1" sessions={activeSessions} />);
    act(() => {
      requestDiceBroadcast({ requestId: 'req-2', roll: parsedRoll });
    });

    expect(sendDiceRoll).not.toHaveBeenCalled();
    expect(deliveries).toEqual([{ requestId: 'req-2', delivered: false }]);
    unsubscribe();
  });
});
