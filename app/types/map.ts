import type { GridType } from './schemas/maps';

export interface MapScale {
  gridType: GridType;
  pixelsPerSquare: number;
  feetPerSquare: number;
}

export interface MapGridOverlay {
  enabled: boolean;
  color: string;
}

export interface MapListItem {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  tags: string[];
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  locationId: string | null;
  scale: MapScale;
  gridOverlay: MapGridOverlay;
  createdAt: string;
  updatedAt: string;
}

export interface MapData extends MapListItem {
  imageKey: string;
}
