import type { MapTokenData } from './mapToken';

/**
 * Tabletop map layers, ordered HIGHEST → LOWEST (the order they stack on the
 * map, top to bottom). Phase 3 ships the framework: all five layers are
 * selectable and individually show/hide-able, the two token layers are fully
 * functional, and Spell FX / Fog of War are placeholders whose authoring tools
 * arrive in a later phase.
 */
export const MAP_LAYERS = [
  { id: 'spell-fx', label: 'Spell FX / Drawing', placeholder: true },
  { id: 'fog', label: 'Fog of War', placeholder: true },
  { id: 'public', label: 'Public Tokens', placeholder: false },
  { id: 'gm-private', label: 'GM-Private Tokens', placeholder: false },
  { id: 'map', label: 'Map', placeholder: false },
] as const;

export type MapLayerId = (typeof MAP_LAYERS)[number]['id'];

/** The two layers that actually hold tokens. */
export type TokenLayerId = Extract<MapLayerId, 'public' | 'gm-private'>;

/**
 * A token's layer is derived from `hiddenFromPlayers`: GM-private tokens are
 * exactly the ones hidden from players, public tokens are visible to everyone.
 * This keeps a single source of truth rather than a parallel `layer` field.
 */
export function tokenLayerId(token: Pick<MapTokenData, 'hiddenFromPlayers'>): TokenLayerId {
  return token.hiddenFromPlayers ? 'gm-private' : 'public';
}

/** Render priority within the stage — higher renders on top (later in DOM). */
export function tokenLayerRenderOrder(token: Pick<MapTokenData, 'hiddenFromPlayers'>): number {
  // Public tokens sit above GM-private tokens.
  return token.hiddenFromPlayers ? 0 : 1;
}
