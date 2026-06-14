/** A freeform text label placed on a map (multiplayer, persisted). */
export interface MapTextData {
  id: string;
  mapId: string;
  campaignId: string;
  /** Position in map-local pixel coordinates. */
  x: number;
  y: number;
  text: string;
  color: string;
  /** Font size in map-local pixels (rendered scaled by the viewport). */
  fontSize: number;
  /** Author user id — a player may delete only their own; a GM may delete any. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
