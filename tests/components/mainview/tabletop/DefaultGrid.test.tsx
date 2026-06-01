import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock react-konva since it requires a canvas environment
vi.mock('react-konva', () => ({
  Stage: ({ children, ...props }: any) => (
    <div data-testid="mock-stage" {...props}>
      {children}
    </div>
  ),
  Layer: ({ children }: any) => <div>{children}</div>,
  Line: () => <div data-testid="mock-line" />,
  Rect: () => <div data-testid="mock-rect" />,
}));

import { DefaultGrid } from '~/components/mainview/tabletop/DefaultGrid';

describe('DefaultGrid', () => {
  it('renders with data-testid', () => {
    const { getByTestId } = render(
      <DefaultGrid width={800} height={600} gridStyle="dark" gridSize={50} gridVisible={true} />
    );
    expect(getByTestId('default-grid')).toBeDefined();
  });

  it('renders grid lines when gridVisible is true', () => {
    const { getAllByTestId } = render(
      <DefaultGrid width={200} height={200} gridStyle="dark" gridSize={50} gridVisible={true} />
    );
    // Should have lines (vertical + horizontal)
    const lines = getAllByTestId('mock-line');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders no grid lines when gridVisible is false', () => {
    const { queryAllByTestId } = render(
      <DefaultGrid width={200} height={200} gridStyle="dark" gridSize={50} gridVisible={false} />
    );
    const lines = queryAllByTestId('mock-line');
    expect(lines.length).toBe(0);
  });

  it('renders empty div when dimensions are zero', () => {
    const { getByTestId, queryByTestId } = render(
      <DefaultGrid width={0} height={0} gridStyle="dark" gridSize={50} gridVisible={true} />
    );
    expect(getByTestId('default-grid')).toBeDefined();
    expect(queryByTestId('mock-stage')).toBeNull();
  });
});
