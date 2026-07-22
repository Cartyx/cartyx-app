import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock hooks used by InspectorSidebar (rendered inside MainView)
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
// This suite only exercises the MainView shell (toolbar/inspector chrome),
// not inspector tab content — mock the heavy panels so components like
// WikiPanel (which needs router context) never mount here.
vi.mock('~/components/wiki/WikiPanel', () => ({
  WikiPanel: () => <div data-testid="wiki-panel" />,
}));
// The WikiCardActionsProvider is now mounted ABOVE MainView in the play route,
// not inside InspectorSidebar, so the InspectorSidebar rendered here no longer
// imports it and the stubbed wiki/note panels have no card-action consumers.
vi.mock('~/components/mainview/NotesPanel', () => ({
  NotesPanel: () => <div data-testid="notes-panel" />,
}));
vi.mock('~/components/mainview/SettingsPanel', () => ({
  SettingsPanel: () => <div data-testid="settings-panel" />,
}));

import { MainView } from '~/components/mainview/MainView';

// Helper to mock matchMedia at a given viewport width
function mockMatchMedia(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => {
      // Only handle the lg breakpoint query used by MainView
      const matches = query === '(min-width: 1024px)' ? width >= 1024 : false;
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

describe('MainView', () => {
  beforeEach(() => {
    // Default: mobile viewport (< lg), so isDesktop = false in all standard tests
    mockMatchMedia(0);
  });

  it('renders children', () => {
    render(
      <MainView>
        <div>Test Content</div>
      </MainView>
    );
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('hides toolbar by default', () => {
    render(
      <MainView>
        <div>Content</div>
      </MainView>
    );
    const toolbar = screen.getByTestId('mainview-toolbar');
    expect(toolbar).toHaveClass('w-0');
    expect(toolbar).not.toHaveClass('w-14');
  });

  it('shows toolbar when showToolbar is true', () => {
    render(
      <MainView showToolbar>
        <div>Content</div>
      </MainView>
    );
    const toolbar = screen.getByTestId('mainview-toolbar');
    expect(toolbar).toHaveClass('w-14');
    expect(toolbar).not.toHaveClass('w-0');
  });

  it('keeps the mobile inspector drawer collapsed by default', () => {
    render(
      <MainView>
        <div>Content</div>
      </MainView>
    );
    const inspector = screen.getByTestId('inspector-shell');
    expect(inspector).toHaveClass('w-0');
    expect(inspector).not.toHaveAttribute('role', 'dialog');
  });

  it('hides inspector when showInspector is false', () => {
    render(
      <MainView showInspector={false}>
        <div>Content</div>
      </MainView>
    );
    expect(screen.queryByTestId('inspector-shell')).not.toBeInTheDocument();
  });

  it('hides both sidebars when both props are false', () => {
    render(
      <MainView showToolbar={false} showInspector={false}>
        <div>Content</div>
      </MainView>
    );
    expect(screen.getByTestId('mainview-toolbar')).toHaveClass('w-0');
    expect(screen.queryByTestId('inspector-shell')).not.toBeInTheDocument();
  });

  it('toolbar toggle is not in DOM when showToolbar is false', () => {
    render(
      <MainView showToolbar={false}>
        <div>Content</div>
      </MainView>
    );
    expect(screen.queryByTestId('toolbar-toggle')).not.toBeInTheDocument();
  });

  it('toolbar toggle is present when showToolbar is true', () => {
    render(
      <MainView showToolbar>
        <div>Content</div>
      </MainView>
    );
    expect(screen.getByTestId('toolbar-toggle')).toBeInTheDocument();
  });

  it('clicking toolbar toggle collapses toolbar from w-14 to w-8', async () => {
    const user = userEvent.setup();
    render(
      <MainView showToolbar>
        <div>Content</div>
      </MainView>
    );
    const toolbar = screen.getByTestId('mainview-toolbar');
    expect(toolbar).toHaveClass('w-14');

    await user.click(screen.getByTestId('toolbar-toggle'));
    expect(toolbar).toHaveClass('w-8');
  });

  it('clicking toolbar toggle twice restores toolbar to w-14', async () => {
    const user = userEvent.setup();
    render(
      <MainView showToolbar>
        <div>Content</div>
      </MainView>
    );
    const toggle = screen.getByTestId('toolbar-toggle');
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.getByTestId('mainview-toolbar')).toHaveClass('w-14');
  });

  describe('inspector toggle', () => {
    it('shows inspector toggle when showInspector is true', () => {
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      expect(screen.getByTestId('mobile-inspector-toggle')).toBeInTheDocument();
    });

    it('inspector toggle has aria-label "Open inspector" initially', () => {
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      expect(screen.getByRole('button', { name: 'Open inspector' })).toBeInTheDocument();
    });

    it('does not show inspector toggle when showInspector is false', () => {
      render(
        <MainView showInspector={false}>
          <div>Content</div>
        </MainView>
      );
      expect(screen.queryByTestId('mobile-inspector-toggle')).not.toBeInTheDocument();
    });

    it('mobile drawer is hidden by default (no dialog role)', () => {
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const inspector = screen.getByTestId('inspector-shell');
      expect(inspector).not.toHaveAttribute('role', 'dialog');
    });

    it('clicking toggle on mobile opens the drawer (dialog role applied)', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      expect(screen.getByTestId('inspector-shell')).toHaveAttribute('role', 'dialog');
    });

    it('toggle button remains visible and marks aria-expanded after click', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const toggle = screen.getByTestId('mobile-inspector-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(screen.getByTestId('mobile-inspector-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('mobile-inspector-toggle')).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    });

    it('mobile toggle chevron rotates between closed and open states', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const icon = screen.getByTestId('mobile-inspector-toggle-icon');
      expect(icon).toHaveClass('rotate-0');

      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      expect(screen.getByTestId('mobile-inspector-toggle-icon')).toHaveClass('rotate-180');
    });

    it('drawer shows backdrop when open on mobile', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      expect(screen.getByTestId('mobile-inspector-backdrop')).toBeInTheDocument();
    });

    it('clicking backdrop closes the drawer', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      await user.click(screen.getByTestId('mobile-inspector-backdrop'));
      expect(screen.getByTestId('inspector-shell')).not.toHaveAttribute('role', 'dialog');
    });

    it('pressing Escape while drawer is open closes the drawer', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      expect(screen.getByTestId('inspector-shell')).toHaveAttribute('role', 'dialog');
      await user.keyboard('{Escape}');
      expect(screen.getByTestId('inspector-shell')).not.toHaveAttribute('role', 'dialog');
    });

    it('clicking close button inside drawer closes it', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      expect(screen.getByTestId('inspector-shell')).toHaveAttribute('role', 'dialog');
      await user.click(screen.getByTestId('mobile-inspector-close'));
      expect(screen.getByTestId('inspector-shell')).not.toHaveAttribute('role', 'dialog');
    });
  });

  describe('desktop inspector toggle', () => {
    beforeEach(() => {
      // Override to desktop viewport for these tests
      mockMatchMedia(1024);
    });

    it('on desktop, inspector is inline and visible by default (lg:w-80 class)', () => {
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      expect(screen.getByTestId('inspector-shell')).toHaveClass('lg:w-80');
      const inspector = screen.getByTestId('inspector-content');
      expect(inspector).toHaveClass('w-80');
    });

    it('on desktop, clicking toggle collapses the inspector shell from the left edge', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const shell = screen.getByTestId('inspector-shell');
      const inspector = screen.getByTestId('inspector-content');
      expect(shell).toHaveClass('lg:w-80');
      expect(inspector).toHaveClass('lg:flex');

      await user.click(screen.getByTestId('desktop-inspector-toggle'));
      expect(shell).toHaveClass('lg:w-0');
      expect(inspector).toHaveClass('lg:hidden');
    });

    it('on desktop, toggle aria-expanded reflects inspectorVisible state', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const toggle = screen.getByTestId('desktop-inspector-toggle');
      // Inspector visible by default on desktop → aria-expanded="true"
      expect(toggle).toHaveAttribute('aria-expanded', 'true');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('on desktop, toggling does not open mobile drawer (no dialog role)', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('desktop-inspector-toggle'));
      expect(screen.getByTestId('inspector-shell')).not.toHaveAttribute('role', 'dialog');
    });

    it('on desktop, clicking toggle twice restores inspector visibility', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const toggle = screen.getByTestId('desktop-inspector-toggle');
      await user.click(toggle);
      await user.click(toggle);
      expect(screen.getByTestId('inspector-shell')).toHaveClass('lg:w-80');
      expect(screen.getByTestId('inspector-content')).toHaveClass('w-80');
    });

    it('on desktop, the toggle sits on the left edge of the inspector shell', () => {
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      expect(screen.getByTestId('desktop-inspector-toggle')).toHaveClass(
        'absolute',
        'left-0',
        '-translate-x-full'
      );
    });

    it('on desktop, the chevron rotates to reflect the open state', async () => {
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const icon = screen.getByTestId('desktop-inspector-toggle-icon');
      expect(icon).toHaveClass('rotate-180');

      await user.click(screen.getByTestId('desktop-inspector-toggle'));
      expect(screen.getByTestId('desktop-inspector-toggle-icon')).toHaveClass('rotate-0');
    });
  });

  describe('toggle visibility and left-edge positioning', () => {
    it('mobile toggle is rendered inside the inspector shell', () => {
      mockMatchMedia(0);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const shell = screen.getByTestId('inspector-shell');
      const mobileToggle = screen.getByTestId('mobile-inspector-toggle');
      expect(shell).toContainElement(mobileToggle);
    });

    it('mobile toggle is positioned on the left edge of the inspector shell', () => {
      mockMatchMedia(0);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const mobileToggle = screen.getByTestId('mobile-inspector-toggle');
      expect(mobileToggle).toHaveClass('absolute', 'left-0', '-translate-x-full');
    });

    it('mobile toggle is visible when drawer is closed', () => {
      mockMatchMedia(0);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      expect(screen.getByTestId('mobile-inspector-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-shell')).not.toHaveClass('hidden');
    });

    it('mobile toggle is visible when drawer is open', async () => {
      mockMatchMedia(0);
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      expect(screen.getByTestId('mobile-inspector-toggle')).toBeInTheDocument();
    });

    it('desktop toggle is rendered inside the inspector shell', () => {
      mockMatchMedia(1024);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const shell = screen.getByTestId('inspector-shell');
      const desktopToggle = screen.getByTestId('desktop-inspector-toggle');
      expect(shell).toContainElement(desktopToggle);
    });

    it('desktop toggle is positioned on the left edge of the inspector shell', () => {
      mockMatchMedia(1024);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const desktopToggle = screen.getByTestId('desktop-inspector-toggle');
      expect(desktopToggle).toHaveClass('absolute', 'left-0', '-translate-x-full');
    });

    it('desktop toggle remains in DOM when inspector is collapsed', async () => {
      mockMatchMedia(1024);
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('desktop-inspector-toggle'));
      expect(screen.getByTestId('inspector-shell')).toHaveClass('lg:w-0');
      expect(screen.getByTestId('desktop-inspector-toggle')).toBeInTheDocument();
    });

    it('on mobile, inspector content is hidden when drawer is closed', () => {
      mockMatchMedia(0);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const content = screen.getByTestId('inspector-content');
      expect(content).toHaveClass('hidden');
      expect(content).not.toHaveClass('flex');
    });

    it('on mobile, inspector content is visible when drawer is open', async () => {
      mockMatchMedia(0);
      const user = userEvent.setup();
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      await user.click(screen.getByTestId('mobile-inspector-toggle'));
      const content = screen.getByTestId('inspector-content');
      expect(content).toHaveClass('flex');
      expect(content).not.toHaveClass('hidden');
    });

    it('inspector shell is not display:hidden so toggles remain accessible', () => {
      mockMatchMedia(0);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const shell = screen.getByTestId('inspector-shell');
      expect(shell).not.toHaveClass('hidden');
      expect(shell).toHaveClass('w-0');
    });

    it('both toggles have proper button semantics and accessible labels', () => {
      mockMatchMedia(1024);
      render(
        <MainView>
          <div>Content</div>
        </MainView>
      );
      const mobileToggle = screen.getByTestId('mobile-inspector-toggle');
      const desktopToggle = screen.getByTestId('desktop-inspector-toggle');

      expect(mobileToggle).toHaveAttribute('type', 'button');
      expect(mobileToggle).toHaveAttribute('aria-label');
      expect(mobileToggle).toHaveAttribute('aria-expanded');
      expect(mobileToggle).toHaveAttribute('aria-controls', 'mainview-inspector');

      expect(desktopToggle).toHaveAttribute('type', 'button');
      expect(desktopToggle).toHaveAttribute('aria-label');
      expect(desktopToggle).toHaveAttribute('aria-expanded');
      expect(desktopToggle).toHaveAttribute('aria-controls', 'mainview-inspector');
    });
  });
});
