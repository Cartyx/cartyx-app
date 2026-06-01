import { useEffect, useRef, useState } from 'react';
import { DefaultGrid } from './DefaultGrid';
import type { TabletopScreenDetailData } from '~/types/tabletop';

interface TabletopCanvasProps {
  screen: TabletopScreenDetailData | null;
}

export function TabletopCanvas({ screen }: TabletopCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const gridStyle = screen?.gridStyle ?? 'dark';
  const gridSize = screen?.gridSize ?? 50;
  const gridVisible = screen?.gridVisible ?? true;

  return (
    <div ref={containerRef} className="absolute inset-0" data-testid="tabletop-canvas">
      {dimensions.width > 0 && dimensions.height > 0 && (
        <DefaultGrid
          width={dimensions.width}
          height={dimensions.height}
          gridStyle={gridStyle}
          gridSize={gridSize}
          gridVisible={gridVisible}
        />
      )}
    </div>
  );
}
