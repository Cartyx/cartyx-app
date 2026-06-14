import type { TokenSource } from './schemas/mapTokens';

export interface MapTokenData {
  id: string;
  mapId: string;
  campaignId: string;
  sourceCollection: TokenSource;
  sourceDocumentId: string;
  ownerUserId: string | null;
  x: number;
  y: number;
  sizeSquares: number;
  color: string;
  label: string;
  imageUrl: string;
  labelVisible: boolean;
  hiddenFromPlayers: boolean;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
}
