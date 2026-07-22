import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorSidebar } from '~/components/mainview/InspectorSidebar';
import { useDiceRolls } from '~/hooks/useDiceRolls';
import { usePartySession } from '~/hooks/usePartySession';
import { requestDiceBroadcast, onDiceDelivery } from '~/utils/diceRollerBridge';

// WikiPanel internally uses tanstack-router's useParams + the campaign hook
// to decide whether to show the GM-only Monsters category. Mock it out so
// these tests don't need a router context.
vi.mock('~/components/wiki/WikiPanel', () => ({
  WikiPanel: () => <div data-testid="wiki-panel" />,
}));

// InspectorSidebar wraps its panels in WikiCardActionsProvider, which reaches
// for router + campaign/tabletop query context. The real wiki/note consumers
// are stubbed here, so pass the provider through — nothing in these tests reads it.
vi.mock('~/components/wiki/shared/WikiCardActionsProvider', () => ({
  WikiCardActionsProvider: ({ children }: { children: React.ReactNode }) => children,
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

describe('InspectorSidebar', () => {
  it('defaults to the chat tab', () => {
    render(<InspectorSidebar />);
    expect(screen.getByTestId('inspector-panel')).toContainElement(
      screen.getByRole('combobox', { name: 'Session selector' })
    );
  });

  it('renders all 5 tab buttons', () => {
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

  it('tab buttons have type=button', () => {
    render(<InspectorSidebar />);
    const buttons = screen.getAllByRole('tab');
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('type', 'button');
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
