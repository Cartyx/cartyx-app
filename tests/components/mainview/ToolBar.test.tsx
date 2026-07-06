import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolBar } from '~/components/mainview/ToolBar';
import type { ToolType } from '~/components/mainview/ToolBar';

// The interactive dice roller is gated behind VITE_PUBLIC_FF_DICE. Default the
// mock flag to enabled so the existing full-tool-list assertions below keep
// passing; the "dice tool feature flag" describe block toggles it off/on.
let diceFlagEnabled = true;
vi.mock('~/utils/featureFlags', () => ({
  useOptionalFeatureFlag: (flag: string) => ({
    isEnabled: Boolean(flag) && diceFlagEnabled,
    isLoading: false,
  }),
}));

beforeEach(() => {
  diceFlagEnabled = true;
  vi.stubEnv('VITE_PUBLIC_FF_DICE', 'cartyx-dice-dev');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const allTools: ToolType[] = [
  'pointer',
  'hand',
  'drawing',
  'text',
  'ruler',
  'dice',
  'stamp',
  'layer',
];

function renderToolBar(props: Partial<React.ComponentProps<typeof ToolBar>> = {}) {
  const defaults = {
    activeTool: 'pointer' as ToolType,
    onToolChange: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    // Default to GM so the full tool set renders; non-GM gating is tested below.
    isGM: true,
  };
  return render(<ToolBar {...defaults} {...props} />);
}

describe('ToolBar', () => {
  it('renders all 8 tool buttons when expanded (GM)', () => {
    renderToolBar();
    for (const tool of allTools) {
      expect(screen.getByTestId(`tool-${tool}`)).toBeInTheDocument();
    }
  });

  it('hides GM-only tools (drawing, layer) for a non-GM', () => {
    renderToolBar({ isGM: false });
    const gmOnlyTools: ToolType[] = ['drawing', 'layer'];
    for (const tool of gmOnlyTools) {
      expect(screen.queryByTestId(`tool-${tool}`)).not.toBeInTheDocument();
    }
    // Non-GM tools remain available.
    for (const tool of allTools.filter((t) => !gmOnlyTools.includes(t))) {
      expect(screen.getByTestId(`tool-${tool}`)).toBeInTheDocument();
    }
  });

  it('active tool has aria-pressed=true', () => {
    renderToolBar({ activeTool: 'hand' });
    expect(screen.getByTestId('tool-hand')).toHaveAttribute('aria-pressed', 'true');
  });

  it('inactive tools have aria-pressed=false', () => {
    renderToolBar({ activeTool: 'pointer' });
    expect(screen.getByTestId('tool-hand')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('tool-drawing')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToolChange with correct tool when clicked', async () => {
    const user = userEvent.setup();
    const onToolChange = vi.fn();
    renderToolBar({ onToolChange });
    await user.click(screen.getByTestId('tool-ruler'));
    expect(onToolChange).toHaveBeenCalledTimes(1);
    expect(onToolChange).toHaveBeenCalledWith('ruler');
  });

  it('calls onToolChange for each tool when clicked', async () => {
    const user = userEvent.setup();
    const onToolChange = vi.fn();
    renderToolBar({ onToolChange });
    for (const tool of allTools) {
      await user.click(screen.getByTestId(`tool-${tool}`));
    }
    expect(onToolChange).toHaveBeenCalledTimes(allTools.length);
    allTools.forEach((tool, index) => {
      expect(onToolChange).toHaveBeenNthCalledWith(index + 1, tool);
    });
  });

  it('renders collapse toggle button', () => {
    renderToolBar();
    expect(screen.getByTestId('toolbar-toggle')).toBeInTheDocument();
  });

  it('collapse toggle has correct aria-label when expanded', () => {
    renderToolBar({ collapsed: false });
    const toggle = screen.getByTestId('toolbar-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'Collapse toolbar');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapse toggle has correct aria-label when collapsed', () => {
    renderToolBar({ collapsed: true });
    const toggle = screen.getByTestId('toolbar-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'Expand toolbar');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls onToggleCollapse when toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggleCollapse = vi.fn();
    renderToolBar({ onToggleCollapse });
    await user.click(screen.getByTestId('toolbar-toggle'));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('hides tool buttons when collapsed', () => {
    renderToolBar({ collapsed: true });
    for (const tool of allTools) {
      expect(screen.queryByTestId(`tool-${tool}`)).not.toBeInTheDocument();
    }
  });

  it('all tool buttons have type=button', () => {
    renderToolBar();
    for (const tool of allTools) {
      expect(screen.getByTestId(`tool-${tool}`)).toHaveAttribute('type', 'button');
    }
  });

  it('collapse toggle has type=button', () => {
    renderToolBar();
    expect(screen.getByTestId('toolbar-toggle')).toHaveAttribute('type', 'button');
  });
});

describe('dice tool feature flag', () => {
  it('hides the dice tool when the flag is disabled', () => {
    diceFlagEnabled = false;
    renderToolBar();
    expect(screen.queryByTestId('tool-dice')).not.toBeInTheDocument();
  });

  it('shows the dice tool when the flag is enabled', () => {
    diceFlagEnabled = true;
    renderToolBar();
    expect(screen.getByTestId('tool-dice')).toBeInTheDocument();
  });
});
