export const GRID_STYLES = ['dark', 'parchment', 'hex', 'whiteboard'] as const;
export type GridStyle = (typeof GRID_STYLES)[number];

export const TABLETOP_MODES = ['grid', 'map', 'battlemap'] as const;
export type TabletopMode = (typeof TABLETOP_MODES)[number];

export const SESSION_EVENT_TYPES = [
  'reveal_document',
  'reveal_location',
  'map_change',
  'battle_start',
  'token_placed',
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export interface TabletopScreenData {
  id: string;
  campaignId: string;
  name: string;
  tabOrder: number;
  mode: TabletopMode;
  gridStyle: GridStyle;
  gridSize: number;
  gridVisible: boolean;
  gridScale: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TabletopScreenDetailData extends TabletopScreenData {
  windows: WindowData[];
  hydrated: Record<string, HydratedDocument>;
}

export interface WindowData {
  id: string;
  collection: string;
  documentId: string;
  state: 'open' | 'minimized' | 'hidden';
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  zIndex: number;
}

export interface HydratedDocument {
  id: string;
  collection: string;
  title: string;
  content: string;
  isPublic?: boolean;
  link?: string;
}

export interface TabletopPlayerStateData {
  id: string;
  campaignId: string;
  userId: string;
  activeScreenId: string | null;
  viewports: ViewportData[];
  windowOverrides: WindowOverrideData[];
}

export interface ViewportData {
  screenId: string;
  zoom: number;
  panX: number;
  panY: number;
}

export interface WindowOverrideData {
  windowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  state: 'open' | 'minimized' | 'hidden';
}

export interface SessionEventData {
  id: string;
  campaignId: string;
  sessionId: string;
  timestamp: string;
  eventType: SessionEventType;
  documentId: string;
  collection: string;
  tabletopScreenId: string;
  triggeredBy: string;
  displayName: string;
}

// PartyKit message types for tabletop
export type TabletopMessage =
  | { type: 'window:show'; screenId: string; window: WindowData; displayName: string }
  | { type: 'window:close'; screenId: string; windowId: string }
  | { type: 'tab:create'; screen: TabletopScreenData }
  | { type: 'tab:rename'; screenId: string; name: string }
  | { type: 'tab:delete'; screenId: string }
  | { type: 'tab:focus-all'; screenId: string }
  | { type: 'tab:content-added'; screenId: string }
  | {
      type: 'ping';
      screenId: string;
      x: number;
      y: number;
      userId: string;
      userName: string;
      color: string;
    }
  | { type: 'grid:style-change'; screenId: string; gridStyle: GridStyle };
