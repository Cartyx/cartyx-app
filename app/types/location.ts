export interface LocationData {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  locationType: string;
  description: string;
  gmNotes: string;
  isPublic: boolean;
  parentLocations: string[];
  childLocations: string[];
  mapImage: string | null;
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationListItem {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  locationType: string;
  isPublic: boolean;
  parentLocations: string[];
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationTypeData {
  id: string;
  campaignId: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
}
