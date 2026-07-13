export type AoeShape = 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder';

/** A spell area-of-effect template on a map (multiplayer, persisted). */
export interface MapAoEData {
  id: string;
  mapId: string;
  campaignId: string;
  shape: AoeShape;
  /** Origin in map-local pixels — center (sphere/cube/cylinder) or apex (cone/line). */
  originX: number;
  originY: number;
  /** Radius / length / edge, in map-local pixels. */
  sizePx: number;
  /** Line width / cylinder height, in map-local pixels (optional). */
  widthPx?: number;
  /** Aim in radians (cone/line); 0 for radial shapes. */
  rotation: number;
  /** 6-digit hex. */
  color: string;
  /** Author user id — a player may delete only their own; a GM may delete any. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
