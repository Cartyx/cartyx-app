import { useEffect, useState } from 'react';
import { Layer, Circle, Text, Group } from 'react-konva';

export interface PingData {
  id: string;
  x: number;
  y: number;
  userName: string;
  color: string;
  createdAt: number;
}

interface PingOverlayProps {
  pings: PingData[];
  onPingExpired: (id: string) => void;
}

const PING_DURATION_MS = 3000;
const PING_MAX_RADIUS = 30;

export function PingOverlay({ pings, onPingExpired }: PingOverlayProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (pings.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      for (const ping of pings) {
        if (now - ping.createdAt > PING_DURATION_MS) {
          onPingExpired(ping.id);
        }
      }
      setTick((t) => t + 1);
    }, 50);

    return () => clearInterval(interval);
  }, [pings, onPingExpired]);

  return (
    <Layer>
      {pings.map((ping) => {
        const elapsed = Date.now() - ping.createdAt;
        const progress = Math.min(elapsed / PING_DURATION_MS, 1);
        const opacity = 1 - progress;
        const radius = PING_MAX_RADIUS * (0.5 + progress * 0.5);

        return (
          <Group key={ping.id}>
            <Circle
              x={ping.x}
              y={ping.y}
              radius={radius}
              stroke={ping.color}
              strokeWidth={3}
              opacity={opacity}
            />
            <Circle x={ping.x} y={ping.y} radius={5} fill={ping.color} opacity={opacity} />
            <Text
              x={ping.x + 10}
              y={ping.y - 10}
              text={ping.userName}
              fontSize={11}
              fill={ping.color}
              opacity={opacity}
            />
          </Group>
        );
      })}
    </Layer>
  );
}
