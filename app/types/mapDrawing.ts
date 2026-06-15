/** The shape of a freeform drawing placed on a map. */
export type MapDrawingKind = 'pencil' | 'rect' | 'ellipse';

/** A freeform drawing placed on a map (multiplayer, persisted). */
export interface MapDrawingData {
  id: string;
  mapId: string;
  campaignId: string;
  kind: MapDrawingKind;
  color: string;
  /** Line/stroke width in map-local pixels (rendered scaled by the viewport). */
  strokeWidth: number;
  /** Filled vs. outline (rect/ellipse only; ignored for pencil). */
  filled: boolean;
  /** Pencil: flattened [x0, y0, x1, y1, …] map-local points. Empty otherwise. */
  points: number[];
  /** Bounding box for rect/ellipse (map-local pixels). Zero for pencil. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Author user id — a player may modify only their own; a GM may modify any. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
