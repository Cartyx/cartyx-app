# Spells Phase 3 — Spell AoE Overlays on the Map (Design)

**Date:** 2026-07-13
**Status:** Approved design, ready for implementation plan
**Depends on:** Phase 1 (spells) + the existing tabletop (map drawings/text/tokens, realtime map sync). Merged in `dev`.

## Summary

Add a **"Spell AoE" tabletop tool**: pick a shape (sphere / cone / cube / line /
cylinder) and a size in feet, then place a **semi-transparent** area-of-effect
template on the active map so the table can see where an effect (e.g. Fireball)
lands. Templates are **shared** — persisted and broadcast in real time to every
connected player (like map text), **placeable by anyone**, each in the placer's
**chosen color**. The tool is generic (you enter the shape/size); it is not tied
to a specific spell's stored data in this phase.

It reuses the established tabletop machinery: the **ruler tool's** placement
interaction, the **drawing layer's** SVG rendering + coordinate math, the
**map-text** realtime persistence/broadcast model (shared, not GM-gated), the
`spell-fx` layer's visibility gate, and the shared **`ColorPicker`**.

## Decisions (locked)

1. **Invocation:** a generic map toolbar "Spell AoE" tool (shape + size picker),
   not spell-linked (a future "Show on map from a spell" can pre-fill it).
2. **Visibility:** shared — persisted + broadcast to all; **player-visible and
   player-placeable** (anyone, not just the GM).
3. **Semi-transparent** so tokens/terrain underneath stay visible.
4. **Color:** each placer picks a color (full `ColorPicker`, like map text), and
   each template stores its own color.
5. **Size:** entered in **feet**; drawn via the grid scaling engine
   (`feet → px = (feet / feetPerSquare) * pixelsPerSquare`).

## 1. Data model + persistence

New document type, mirroring `MapText`/`MapDrawing` (`app/types/mapAoe.ts`):

```ts
export type AoeShape = 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder';

export interface MapAoEData {
  id: string;
  mapId: string;
  campaignId: string;
  createdBy: string;
  shape: AoeShape;
  originX: number; // map-local pixels — center (sphere/cube/cylinder) or apex (cone/line)
  originY: number;
  sizePx: number; // radius / length / edge, in MAP-LOCAL PIXELS
  widthPx?: number; // line width; (cylinder height is informational, top-down)
  rotation: number; // radians; aim for cone/line (0 for radial shapes)
  color: string; // 6-digit hex
  createdAt: string;
  updatedAt: string;
}
```

Geometry is stored in **map-local pixels** (converted from feet at placement
time using the map's `scale.pixelsPerSquare`/`feetPerSquare`). This matches how
drawings store geometry, so it survives pan/zoom and different clients.

- **Model:** `app/server/db/models/MapAoE.ts` (clone `MapText`/`MapDrawing`
  model: campaignId/mapId/createdBy + fields + indexes on `{campaignId, mapId}`).
- **Zod:** `app/types/schemas/mapAoe.ts` (create/list/remove/clear).
- **Server functions:** `app/server/functions/mapAoE.ts` — `createMapAoE`,
  `listMapAoE`, `removeMapAoE`, `clearMapAoE`. Auth via `requireCampaignMember`:
  **any member may create**; `listMapAoE` **returns AoE to all members**
  (players included); **`removeMapAoE` requires the caller to be the template's
  `createdBy` OR the GM** (a player deletes only their own); **`clearMapAoE` is
  GM-only** (wipes everyone's). The server is the source of truth for these
  checks — the UI gating below is only affordance.
- **Hook:** `app/hooks/useMapAoE.ts` — `useMapAoE(campaignId, mapId)` query +
  `useMapAoEMutations` (create/remove/clear) + `applyAoeAddToCache` /
  `applyAoeRemoveFromCache` / `applyAoeClearToCache` cache helpers (used for both
  optimistic local writes and inbound realtime writes) — cloned from
  `useMapDrawings.ts`.
- **queryKeys:** add a `mapAoe` block.

## 2. Realtime broadcast (shared, text-model)

- Add `aoe:added | aoe:removed | aoe:cleared` variants to the
  `TabletopMapMessage` union in `app/hooks/useTabletopMapParty.ts` (room/party
  unchanged: `tabletop-map-${campaignId}`).
- Each mutation's `onSuccess` applies the authoritative doc to the local cache
  then `onBroadcast({ type: 'aoe:added', mapId, aoe })` (same pattern as
  `drawing:added` in `ActiveMapStage.tsx`).
- Inbound: add an `aoe:*` branch to the reducer in
  `app/hooks/useTabletopMapSync.ts` that dispatches to the `applyAoe*ToCache`
  helpers. **Follow the text path, not the drawing path** — do NOT add `aoe:` to
  the GM-only drop-gate; AoE is shared to players.

## 3. Placement interaction (`useAoeTool`, ruler-style)

New `app/components/mainview/tabletop/useAoeTool.ts`, modeled on `useRulerTool`:

- Armed while the Spell AoE tool's "Place on map" is active (an `aoeActive`
  boolean prop, like `rulerActive`); it **short-circuits the stage pointer
  handlers** the same way the ruler does.
- **First click** → sets the **origin** (`domToImage`, clamped to image bounds):
  center for sphere/cube/cylinder, apex for cone/line.
  - **Radial shapes (sphere/cube/cylinder):** the first click **commits**
    immediately at the tool's entered size.
  - **Directional shapes (cone/line):** after the origin click, the template
    **rotates to follow the cursor** (`onPointerMove` sets `rotation =
atan2(cursor−origin)`); a **second click commits**.
- **Esc / double-click** cancels the in-progress placement (reuse the ruler's
  Esc handler + `onDoubleClick` reset wiring).
- On commit → `create.mutate(...)` → cache + broadcast (§2).
- State: `{ origin: ImagePoint | null, cursor: ImagePoint | null }`; exposes an
  in-progress **preview** shape.

## 4. Rendering (`MapAoELayer`, SVG on `spell-fx`)

New `app/components/mainview/tabletop/MapAoELayer.tsx`, modeled on
`MapDrawingLayer`: one `pointer-events-none` `<svg className="absolute inset-0
… ">` overlay. Each template positioned with the shared transform
`imageOffsetX + x*effectiveScale`; sizes scaled by `effectiveScale`.
Semi-transparent: `fill={color}` + `fillOpacity={0.3}`, `stroke={color}` +
`strokeOpacity={0.9}` (tokens underneath remain visible).

Shape geometry (in an aim-aligned local frame, then rotated by `rotation` and
translated to origin):

- **sphere / cylinder** → `<circle>` r = `sizePx` (radius). (Cylinder is drawn
  as its top-down circle; `widthPx`/height is metadata.)
- **cube** → `<rect>` edge = `sizePx`, centered on origin (axis-aligned).
- **line** → rectangle length `sizePx` × width `widthPx`, from origin along the
  aim: corners `(0,±W/2)`,`(L,±W/2)` → rotate → `<polygon>`.
- **cone** → 5e cone (width == length at the far edge): apex at origin, base
  corners `(L, +L/2)` and `(L, −L/2)` → rotate → `<polygon>` (isosceles triangle).

Rendered in the stage's compositing after the map/grid and gated by
`!hiddenLayers.has('spell-fx')`. An in-progress placement renders as a
non-interactive **preview** (reuse the drawing `preview` pattern). Stacking:
below tokens/text so tokens stay readable on top of the tint (place the AoE SVG
just above the grid, below `MapDrawingLayer`/tokens).

## 5. Tool UI

- **`AoeSettingsPanel.tsx`** (clone `TextSettingsPanel`/`DrawingSettingsPanel`):
  five **shape** buttons, a **Size (ft)** number field, a **Width (ft)** field
  shown for `line` (and cylinder height, optional), the shared **`ColorPicker`**,
  and a **"Place on map"** arm button + a **"Clear all AoE"** action.
- Register a new **`ToolWindowId` `'aoe'`** in `toolWindowState.ts` and a toolbar
  entry (an SVG/lucide icon) alongside Draw/Text/Ruler.
- **Player-accessible:** the tool must be available to players, not GM-only
  (unlike the draw tool). Verify the toolbar/ToolWindow gating and expose it to
  all session participants. When placing, feet → `sizePx` is computed once from
  the current map's `scale`.

## 6. Clearing / removing

- Clicking an existing template selects it; **Delete** removes it (broadcast
  `aoe:removed`). Reuse the drawing selection-lite pattern (a hit target per
  template), but **no resize handles** in this phase. A player may delete **only
  templates they placed** (`createdBy === user`); the **GM may delete any**. The
  delete affordance is shown accordingly, and the server enforces it.
- **"Clear all AoE"** removes every template on the map (broadcast
  `aoe:cleared`) — **GM-only** (shown only to the GM; server rejects non-GM).
- Templates persist on the map until removed (they don't auto-expire).

## 7. Out of scope (this phase)

- Drag-to-resize / drag-to-move existing templates (place + delete only).
- Grid snapping of the origin.
- Auto-fill from a specific spell's `areaOfEffect`/`range` ("Show on map from a
  spell" — a later enhancement; the data is already stored on spells).
- Range enforcement (how far the origin may be from a caster token).
- Non-square grids (uses `scale.gridType === 'square'`; if no grid scale, fall
  back to a sane default and note it).

## 8. Testing

- **Geometry unit tests** (`aoeGeometry.ts`): feet→px; cone triangle corners;
  rotated line rectangle; radial circle radius — deterministic, no DOM.
- **Placement hook** (`useAoeTool`): origin→(aim)→commit state machine for radial
  vs directional shapes; Esc/double-click cancel; commit calls create with the
  right geometry.
- **`useMapAoE`**: create/remove/clear apply to cache + fire the right broadcast
  (mocked socket), following the `useMapDrawings` test pattern.
- **Realtime sync**: an inbound `aoe:added` message applies to the cache for a
  non-GM receiver (shared, unlike drawings).
- **Component**: `AoeSettingsPanel` arms placement + changes shape/size/color;
  `MapAoELayer` renders each shape with the expected SVG element.
- Gates: `npm test`, `npm run typecheck`, `npm run lint` clean.

## Notes

- After any data-shape work that touches the SRD generator, no regeneration is
  needed here (Phase 3 adds a new collection, not spell data).
- To exercise the shared broadcast locally, run `npm run dev` (now starts the web
  app + realtime ws service together) and reset dev data per the
  `resetting-dev-data` skill if needed.
