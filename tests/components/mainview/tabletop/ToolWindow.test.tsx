import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Ruler } from 'lucide-react';
import { ToolWindow } from '~/components/mainview/tabletop/ToolWindow';

function renderWindow(overrides: Partial<React.ComponentProps<typeof ToolWindow>> = {}) {
  const props = {
    id: 'ruler',
    title: 'Measurement',
    icon: Ruler,
    position: { x: 20, y: 30 },
    zIndex: 41,
    placed: true,
    onClose: vi.fn(),
    onFocus: vi.fn(),
    onHeaderPointerDown: vi.fn(),
    rootRef: () => {},
    children: <div data-testid="content">hi</div>,
    ...overrides,
  };
  render(<ToolWindow {...props} />);
  return props;
}

describe('ToolWindow', () => {
  it('renders grip, icon, uppercase title, close X, and content', () => {
    renderWindow();
    const win = screen.getByTestId('tool-window-ruler');
    expect(win).toBeTruthy();
    expect(screen.getByTestId('tool-window-ruler-header')).toBeTruthy();
    expect(screen.getByText('Measurement')).toBeTruthy();
    expect(screen.getByLabelText('Close measurement window')).toBeTruthy();
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('positions via left/top/zIndex and hides until placed', () => {
    renderWindow({ placed: false });
    const win = screen.getByTestId('tool-window-ruler');
    expect(win.style.left).toBe('20px');
    expect(win.style.top).toBe('30px');
    expect(win.style.zIndex).toBe('41');
    expect(win.style.visibility).toBe('hidden');
  });

  it('X click calls onClose without starting a drag', () => {
    const props = renderWindow();
    fireEvent.click(screen.getByTestId('tool-window-ruler-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onHeaderPointerDown).not.toHaveBeenCalled();
  });

  it('header pointerdown starts a drag; window pointerdown focuses', () => {
    const props = renderWindow();
    fireEvent.pointerDown(screen.getByTestId('tool-window-ruler-header'));
    expect(props.onHeaderPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId('tool-window-ruler'));
    expect(props.onFocus).toHaveBeenCalled();
  });
});
