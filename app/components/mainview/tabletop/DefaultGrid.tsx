import { Stage, Layer, Line, Rect } from 'react-konva';
import type { GridStyle } from '~/types/tabletop';

interface DefaultGridProps {
  width: number;
  height: number;
  gridStyle: GridStyle;
  gridSize: number;
  gridVisible: boolean;
}

const GRID_THEMES: Record<GridStyle, { bg: string; line: string; lineOpacity: number }> = {
  dark: { bg: '#0D1117', line: '#1a2332', lineOpacity: 0.8 },
  parchment: { bg: '#f4e4c1', line: '#c4a882', lineOpacity: 0.5 },
  hex: { bg: '#0D1117', line: '#1a2332', lineOpacity: 0.8 },
  whiteboard: { bg: '#ffffff', line: '#e0e0e0', lineOpacity: 0.6 },
};

export function DefaultGrid({ width, height, gridStyle, gridSize, gridVisible }: DefaultGridProps) {
  const theme = GRID_THEMES[gridStyle];

  const verticalLines: number[][] = [];
  const horizontalLines: number[][] = [];

  if (gridVisible && width > 0 && height > 0) {
    for (let x = 0; x <= width; x += gridSize) {
      verticalLines.push([x, 0, x, height]);
    }
    for (let y = 0; y <= height; y += gridSize) {
      horizontalLines.push([0, y, width, y]);
    }
  }

  if (width <= 0 || height <= 0) {
    return <div data-testid="default-grid" />;
  }

  return (
    <div data-testid="default-grid">
      <Stage width={width} height={height}>
        <Layer>
          <Rect x={0} y={0} width={width} height={height} fill={theme.bg} />
          {verticalLines.map((points, i) => (
            <Line
              key={`v-${i}`}
              points={points}
              stroke={theme.line}
              strokeWidth={1}
              opacity={theme.lineOpacity}
            />
          ))}
          {horizontalLines.map((points, i) => (
            <Line
              key={`h-${i}`}
              points={points}
              stroke={theme.line}
              strokeWidth={1}
              opacity={theme.lineOpacity}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
