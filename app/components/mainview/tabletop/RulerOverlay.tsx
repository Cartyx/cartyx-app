import type { RulerMeasurement } from './useRulerTool';

/**
 * Renders the measurement (ruler) overlay — the polyline, endpoints/waypoints,
 * and per-segment feet labels — for a resolved RulerMeasurement.
 */
export function RulerOverlay({
  measurement,
  rulerColor,
}: {
  measurement: RulerMeasurement;
  rulerColor: string;
}) {
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-30 h-full w-full"
        data-testid="ruler-line"
        aria-hidden="true"
      >
        {measurement.segments.map((seg) => {
          const key = `${seg.a.x},${seg.a.y}-${seg.b.x},${seg.b.y}`;
          return (
            <g key={key}>
              {/* Dark halo underlay so the line reads on any map background. */}
              <line
                x1={seg.a.x}
                y1={seg.a.y}
                x2={seg.b.x}
                y2={seg.b.y}
                stroke="#000000"
                strokeOpacity={0.6}
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray="6 4"
              />
              <line
                x1={seg.a.x}
                y1={seg.a.y}
                x2={seg.b.x}
                y2={seg.b.y}
                stroke={rulerColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray="6 4"
                data-testid="ruler-line-stroke"
              />
            </g>
          );
        })}
        {/* Intermediate waypoints. */}
        {measurement.waypoints.map((wp) => (
          <circle
            key={`${wp.x},${wp.y}`}
            cx={wp.x}
            cy={wp.y}
            r={5}
            fill={rulerColor}
            stroke="#000000"
            strokeOpacity={0.7}
            strokeWidth={2}
            data-testid="ruler-waypoint"
          />
        ))}
        {/* Live / final endpoint. */}
        <circle
          cx={measurement.end.x}
          cy={measurement.end.y}
          r={5}
          fill={rulerColor}
          stroke="#000000"
          strokeOpacity={0.7}
          strokeWidth={2}
        />
        {/* Anchor (drawn last so it sits above an overlapping waypoint). */}
        <circle
          cx={measurement.anchor.x}
          cy={measurement.anchor.y}
          r={7}
          fill={rulerColor}
          fillOpacity={0.95}
          stroke="#000000"
          strokeOpacity={0.7}
          strokeWidth={2}
          data-testid="ruler-anchor"
        />
      </svg>
      {measurement.segments.map((seg) => (
        <div
          key={`${seg.mid.x},${seg.mid.y}`}
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border-2 bg-black/90 px-2.5 py-1 font-mono text-base font-bold text-white shadow-lg"
          style={{ left: seg.mid.x, top: seg.mid.y, borderColor: rulerColor }}
          data-testid="ruler-distance"
        >
          {seg.feet} ft
        </div>
      ))}
    </>
  );
}
