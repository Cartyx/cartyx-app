# Spells Phase 3 Implementation Plan — Spell AoE Overlays on the Map

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** A generic "Spell AoE" tabletop tool — pick a shape + size (ft), place a semi-transparent template on the active map; shared/broadcast to all players, each in the placer's color; players delete their own, GM clears all.

**Architecture:** A new persisted `MapAoE` map-object (cloned from the shared map-**text** model: created by any member, visible to all, per-object `createdBy`), broadcast over the existing tabletop-map party. A pure geometry module converts feet→pixels and each shape→SVG geometry; `MapAoELayer` renders it; `useAoeTool` drives ruler-style placement; an `AoeSettingsPanel` tool window arms it. Wired into `ActiveMapStage` like the ruler + drawing layers.

**Tech Stack:** TanStack Start (React 19), TypeScript, Mongoose, Zod, Vitest, the tabletop realtime stack (`useTabletopMapParty`/`useTabletopMapSync`).

**Spec:** `docs/spells/2026-07-13-spells-phase3-aoe-design.md`

## Global Constraints

- Tests under `tests/` mirroring app paths (`~/` imports). Mongoose globally mocked (`tests/setup.ts`) — no in-memory DB; server-fn tests follow `tests/server/functions/rules.test.ts` (mock session/connection/models; real `requireCampaignMember`).
- `npm test`, `npm run typecheck`, `npm run lint` clean; lint baseline 0 errors + 24 warnings, no new warnings. No new npm dependencies.
- **AoE follows the shared map-TEXT model, not GM-only drawings:** created by any member, returned to all members, and (crucially) NOT added to the GM-only inbound drop-gate in `useTabletopMapSync.ts:42-50`.
- Geometry stored in **map-local pixels**; rendered via the shared transform `imageOffsetX + x*effectiveScale` (see `MapDrawingLayer.tsx`).
- Auth: create = any member; remove = `createdBy` OR GM; clear = GM-only. Server enforces; UI only gates affordance.

## Template files to clone (named per task)

- Data model: `app/types/mapText.ts`, `app/server/db/models/MapText.ts`, `app/types/schemas/mapText*.ts`
- Server fns: `app/server/functions/mapTexts.ts`
- Hook + cache helpers: `app/hooks/useMapTexts.ts`
- Realtime: `app/hooks/useTabletopMapParty.ts` (message union + `parseTabletopMapMessage`), `app/hooks/useTabletopMapSync.ts`
- Render: `app/components/mainview/tabletop/MapDrawingLayer.tsx`, `MapTextLayer.tsx`
- Placement: `app/components/mainview/tabletop/useRulerTool.ts`
- Tool UI: `app/components/mainview/tabletop/DrawingSettingsPanel.tsx`, `TextSettingsPanel.tsx`, `toolWindowState.ts`, `~/components/shared/ColorPicker`
- Stage wiring: `app/components/mainview/tabletop/ActiveMapStage.tsx` (ruler + drawing integration points)

---

## Task 1: Data model — type, Zod, Mongoose

**Files:**

- Create: `app/types/mapAoe.ts`
- Create: `app/types/schemas/mapAoe.ts`
- Create: `app/server/db/models/MapAoE.ts`
- Test: `tests/server/db/mapaoe-model.test.ts`

**Interfaces:**

- Produces: `MapAoEData`, `AoeShape`; `createMapAoESchema`/`listMapAoESchema`/`removeMapAoESchema`/`clearMapAoESchema`; the `MapAoE` model.

- [ ] **Step 1: `app/types/mapAoe.ts`**

```ts
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
```

- [ ] **Step 2: `app/types/schemas/mapAoe.ts`**

```ts
import { z } from 'zod';

export const AOE_SHAPES = ['sphere', 'cone', 'cube', 'line', 'cylinder'] as const;

export const createMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  shape: z.enum(AOE_SHAPES),
  originX: z.number(),
  originY: z.number(),
  sizePx: z.number().positive(),
  widthPx: z.number().positive().optional(),
  rotation: z.number(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const listMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});
export const removeMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  id: z.string().trim().min(1),
});
export const clearMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});
```

- [ ] **Step 3: `app/server/db/models/MapAoE.ts`** — clone `app/server/db/models/MapText.ts`; replace text-specific fields (`text`, `fontSize`, `x`, `y`) with `shape`, `originX`, `originY`, `sizePx`, `widthPx`, `rotation`, `color`. Keep `mapId`/`campaignId`/`createdBy`/timestamps and the `{ campaignId: 1, mapId: 1 }` index and the `mongoose.models.MapAoE || mongoose.model(...)` guard.

- [ ] **Step 4: `tests/server/db/mapaoe-model.test.ts`** — existence-level (Mongoose is mocked), like `tests/server/db/spell-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MapAoE } from '~/server/db/models/MapAoE';
describe('MapAoE model', () => {
  it('is exported and defined', () => {
    expect(MapAoE).toBeDefined();
  });
});
```

- [ ] **Step 5:** `npm test -- tests/server/db/mapaoe-model.test.ts` (PASS), `npm run typecheck && npm run lint` clean. Commit:

```bash
git add app/types/mapAoe.ts app/types/schemas/mapAoe.ts app/server/db/models/MapAoE.ts tests/server/db/mapaoe-model.test.ts
git commit -m "feat(aoe): add MapAoE model, types, and schemas"
```

---

## Task 2: Geometry module (pure, tested)

**Files:**

- Create: `app/components/mainview/tabletop/aoeGeometry.ts`
- Test: `tests/components/mainview/tabletop/aoeGeometry.test.ts`

**Interfaces:**

- Produces: `feetToPixels(feet, { pixelsPerSquare, feetPerSquare })`, and `aoeShapeGeometry(aoe)` returning a discriminated union of map-local `{ kind:'circle', cx,cy,r } | { kind:'rect', x,y,w,h } | { kind:'polygon', points:{x,y}[] }`. Consumed by Task 6 (layer) and Task 7 (preview).

- [ ] **Step 1: `app/components/mainview/tabletop/aoeGeometry.ts`**

```ts
import type { AoeShape } from '~/types/mapAoe';

export function feetToPixels(
  feet: number,
  scale: { pixelsPerSquare: number; feetPerSquare: number }
): number {
  const perSquare = scale.feetPerSquare || 5;
  return (feet / perSquare) * (scale.pixelsPerSquare || 1);
}

export interface AoeInput {
  shape: AoeShape;
  originX: number;
  originY: number;
  sizePx: number;
  widthPx?: number;
  rotation: number;
}

export type AoeShapeGeometry =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> };

/** Map-local geometry for an AoE template. Line/cone are rotated by `rotation`. */
export function aoeShapeGeometry(aoe: AoeInput): AoeShapeGeometry {
  const { shape, originX: ox, originY: oy, sizePx: L, rotation } = aoe;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // local (aim-aligned, apex/origin at 0,0) → map-local
  const at = (lx: number, ly: number) => ({
    x: ox + (lx * cos - ly * sin),
    y: oy + (lx * sin + ly * cos),
  });

  if (shape === 'sphere' || shape === 'cylinder') {
    return { kind: 'circle', cx: ox, cy: oy, r: L };
  }
  if (shape === 'cube') {
    // Axis-aligned square centered on the origin.
    return { kind: 'rect', x: ox - L / 2, y: oy - L / 2, w: L, h: L };
  }
  if (shape === 'line') {
    const W = aoe.widthPx ?? Math.max(1, L / 20);
    return { kind: 'polygon', points: [at(0, -W / 2), at(L, -W / 2), at(L, W / 2), at(0, W / 2)] };
  }
  // cone — 5e: width == length at the far edge (isosceles triangle, apex at origin)
  return { kind: 'polygon', points: [at(0, 0), at(L, L / 2), at(L, -L / 2)] };
}
```

- [ ] **Step 2: `tests/components/mainview/tabletop/aoeGeometry.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { feetToPixels, aoeShapeGeometry } from '~/components/mainview/tabletop/aoeGeometry';

describe('feetToPixels', () => {
  it('converts feet using the grid scale', () => {
    // 20 ft on a 5-ft, 50px grid = 4 squares = 200 px
    expect(feetToPixels(20, { pixelsPerSquare: 50, feetPerSquare: 5 })).toBe(200);
  });
});

describe('aoeShapeGeometry', () => {
  const base = { originX: 100, originY: 100, sizePx: 40, rotation: 0 };
  it('sphere/cylinder → circle at origin', () => {
    expect(aoeShapeGeometry({ ...base, shape: 'sphere' })).toEqual({
      kind: 'circle',
      cx: 100,
      cy: 100,
      r: 40,
    });
    expect(aoeShapeGeometry({ ...base, shape: 'cylinder' }).kind).toBe('circle');
  });
  it('cube → centered square', () => {
    expect(aoeShapeGeometry({ ...base, shape: 'cube' })).toEqual({
      kind: 'rect',
      x: 80,
      y: 80,
      w: 40,
      h: 40,
    });
  });
  it('line at rotation 0 → rectangle extending +x', () => {
    const g = aoeShapeGeometry({ ...base, shape: 'line', widthPx: 10 });
    expect(g.kind).toBe('polygon');
    if (g.kind === 'polygon') {
      expect(g.points[0]).toEqual({ x: 100, y: 95 }); // (0,-5)
      expect(g.points[1]).toEqual({ x: 140, y: 95 }); // (40,-5)
      expect(g.points[2]).toEqual({ x: 140, y: 105 }); // (40,5)
    }
  });
  it('cone at rotation 0 → apex at origin, base at x=origin+L', () => {
    const g = aoeShapeGeometry({ ...base, shape: 'cone' });
    if (g.kind === 'polygon') {
      expect(g.points[0]).toEqual({ x: 100, y: 100 }); // apex
      expect(g.points[1]).toEqual({ x: 140, y: 120 }); // (L, L/2)
      expect(g.points[2]).toEqual({ x: 140, y: 80 }); // (L, -L/2)
    }
  });
  it('rotates line/cone by rotation', () => {
    const g = aoeShapeGeometry({ ...base, shape: 'cone', rotation: Math.PI / 2 });
    if (g.kind === 'polygon') {
      // apex unchanged; far edge now points +y
      expect(g.points[0]).toEqual({ x: 100, y: 100 });
      expect(g.points[1].y).toBeCloseTo(140);
    }
  });
});
```

- [ ] **Step 3:** `npm test -- tests/components/mainview/tabletop/aoeGeometry.test.ts` (PASS), typecheck/lint clean. Commit `feat(aoe): add AoE geometry (feet→px + shape → svg geometry)`.

---

## Task 3: Server functions (auth: create/list/remove/clear)

**Files:**

- Create: `app/server/functions/mapAoE.ts`
- Test: `tests/server/functions/mapAoE.test.ts`

**Interfaces:**

- Produces: `createMapAoE`, `listMapAoE`, `removeMapAoE`, `clearMapAoE` (`async ({ data }) => …`).

- [ ] **Step 1: Clone `app/server/functions/mapTexts.ts` → `mapAoE.ts`**, adapting:
  - `createMapAoE` — `requireCampaignMember` (any member); build a `MapAoE` doc from `createMapAoESchema` fields + `createdBy: member.userId`; `MapAoE.create(...)`; serialize + return.
  - `listMapAoE` — `requireCampaignMember`; `MapAoE.find({ campaignId, mapId }).sort({ createdAt: 1 }).lean()`; **return to all members** (no GM filter).
  - `removeMapAoE` — `requireCampaignMember`; fetch the doc; **allow if `String(doc.createdBy) === member.userId || member.isGM`, else throw `'Forbidden'`**; `doc.deleteOne()`.
  - `clearMapAoE` — `requireCampaignMember`; **`if (!member.isGM) throw new Error('Forbidden')`**; `MapAoE.deleteMany({ campaignId, mapId })`.
  - Re-export the schemas; wrap each in try/catch with `serverCaptureException` like the other map functions.

- [ ] **Step 2: `tests/server/functions/mapAoE.test.ts`** — mock pattern from `tests/server/functions/rules.test.ts` (mock `~/server/session`, `~/server/db/connection`, `~/server/db/models/User`, `~/server/db/models/Campaign`, `~/server/db/models/MapAoE`, telemetry). Cover:
  - `createMapAoE` sets `createdBy` to the member and returns the doc; a non-member is rejected (via `requireCampaignMember`).
  - `listMapAoE` returns docs to a **player** (non-GM) — not GM-gated.
  - `removeMapAoE`: player removes own (mock `MapAoE.findOne` → `{ createdBy: 'dbuser-1', deleteOne }`) → succeeds; player removing another's (`createdBy: 'other'`, isGM false) → throws `'Forbidden'`; GM removes any → succeeds.
  - `clearMapAoE`: GM → `deleteMany` called; non-GM → throws `'Forbidden'`.

  Use `mockGMCampaign`/`mockPlayerCampaign` from the rules pattern to flip GM.

- [ ] **Step 3:** run the test (PASS), typecheck/lint clean. Commit `feat(aoe): add map AoE server functions with per-owner/GM auth`.

---

## Task 4: Hook + cache helpers + query keys

**Files:**

- Modify: `app/utils/queryKeys.ts` (add `mapAoe` block after `mapDrawings`/`mapTexts`)
- Create: `app/hooks/useMapAoE.ts`

**Interfaces:**

- Produces: `useMapAoE(campaignId, mapId)`; `useMapAoEMutations` (`create`/`remove`/`clear`); `applyAoeAddToCache`, `applyAoeRemoveFromCache`, `applyAoeClearToCache`.

- [ ] **Step 1:** Add to `app/utils/queryKeys.ts`:

```ts
  mapAoe: {
    all: ['mapAoe'] as const,
    list: (campaignId: string, mapId: string) => ['mapAoe', 'list', campaignId, mapId] as const,
  },
```

- [ ] **Step 2: Clone `app/hooks/useMapTexts.ts` → `useMapAoE.ts`**, adapting names (`text`→`aoe`, `MapTextData`→`MapAoEData`), the server-fn imports (`~/server/functions/mapAoE`), the query key (`queryKeys.mapAoe.list`), and the mutation set to **create/remove/clear** (drop update/move — AoE isn't edited/moved this phase). Keep the `apply*ToCache` helpers: `applyAoeAddToCache` (append), `applyAoeRemoveFromCache` (filter by id), `applyAoeClearToCache` (empty the list). Each `createServerFn` wrapper dynamically imports `~/server/functions/mapAoE`.

- [ ] **Step 3:** typecheck/lint clean (thin RPC wiring; no dedicated unit test, like `useMapTexts`/`useRaces`). Commit `feat(aoe): add useMapAoE hook + cache helpers + query keys`.

---

## Task 5: Realtime — message union + inbound sync

**Files:**

- Modify: `app/hooks/useTabletopMapParty.ts` (union + `parseTabletopMapMessage`)
- Modify: `app/hooks/useTabletopMapSync.ts` (inbound branch, shared)

**Interfaces:**

- Produces: `aoe:added | aoe:removed | aoe:cleared` messages; inbound reducer applies them to the cache for all viewers.

- [ ] **Step 1:** In `app/hooks/useTabletopMapParty.ts` add to the `TabletopMapMessage` union (next to `drawing:*`) and to `parseTabletopMapMessage` validation:

```ts
  | { type: 'aoe:added'; mapId: string; aoe: MapAoEData }
  | { type: 'aoe:removed'; mapId: string; aoeId: string }
  | { type: 'aoe:cleared'; mapId: string }
```

Import `MapAoEData` and validate the new variants the same way `drawing:*` are validated (shape check on `msg.aoe`, `msg.aoeId`, `msg.mapId`).

- [ ] **Step 2:** In `app/hooks/useTabletopMapSync.ts`: import the `applyAoe*ToCache` helpers from `./useMapAoE`, and add branches to the reducer **after** the `drawing:*` branches — **outside** the `if (!isGM)` drop-gate (AoE is shared):

```ts
    } else if (msg.type === 'aoe:added') {
      applyAoeAddToCache(queryClient, campaignId, msg.mapId, msg.aoe);
    } else if (msg.type === 'aoe:removed') {
      applyAoeRemoveFromCache(queryClient, campaignId, msg.mapId, msg.aoeId);
    } else if (msg.type === 'aoe:cleared') {
      applyAoeClearToCache(queryClient, campaignId, msg.mapId);
    }
```

- [ ] **Step 3: Test** the shared-visibility invariant in `tests/hooks/useTabletopMapSync.test.tsx` (if a sync test exists) or a focused new test: an inbound `aoe:added` message applies to the cache **even for a non-GM** receiver (contrast with `drawing:added`, which is dropped for non-GM). If no sync test harness exists, assert `parseTabletopMapMessage` accepts a valid `aoe:added` and rejects a malformed one in a new `tests/hooks/useTabletopMapParty.test.ts` (check the repo for an existing party test to extend).

- [ ] **Step 4:** typecheck/lint clean, `npm test` green. Commit `feat(aoe): broadcast + sync AoE templates (shared, not GM-gated)`.

---

## Task 6: `MapAoELayer` (render)

**Files:**

- Create: `app/components/mainview/tabletop/MapAoELayer.tsx`
- Test: `tests/components/mainview/tabletop/MapAoELayer.test.tsx`

**Interfaces:**

- Consumes: `aoeShapeGeometry` (Task 2), `MapAoEData`.
- Produces: `MapAoELayer` (`{ visible, aoes, preview, effectiveScale, imageOffsetX, imageOffsetY, currentUserId, isGM, onSelect?, selectedId? }`).

- [ ] **Step 1: `app/components/mainview/tabletop/MapAoELayer.tsx`** — one `pointer-events-none` SVG overlay (like `MapDrawingLayer`), each template converted from map-local geometry to DOM via `imageOffsetX + x*effectiveScale`. Semi-transparent fill.

```tsx
import type { MapAoEData } from '~/types/mapAoe';
import { aoeShapeGeometry, type AoeInput } from './aoeGeometry';

interface MapAoELayerProps {
  visible: boolean;
  aoes: MapAoEData[];
  preview: (AoeInput & { color: string }) | null;
  effectiveScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  /** A template can be selected/deleted only by its author or the GM. */
  canModify?: (a: MapAoEData) => boolean;
}

export function MapAoELayer({
  visible,
  aoes,
  preview,
  effectiveScale,
  imageOffsetX,
  imageOffsetY,
  onSelect,
  selectedId,
  canModify,
}: MapAoELayerProps) {
  if (!visible) return null;
  const toDomX = (x: number) => imageOffsetX + x * effectiveScale;
  const toDomY = (y: number) => imageOffsetY + y * effectiveScale;

  const renderShape = (
    input: AoeInput,
    color: string,
    opts: { id?: string; interactive: boolean }
  ) => {
    const g = aoeShapeGeometry(input);
    const selectable = opts.interactive && !!opts.id;
    const common = {
      'data-testid': opts.id ? 'map-aoe' : undefined,
      'data-aoe-id': opts.id,
      'data-aoe-shape': input.shape,
      fill: color,
      fillOpacity: 0.3,
      stroke: color,
      strokeOpacity: 0.9,
      strokeWidth: Math.max(1, 2 * effectiveScale),
      style: { pointerEvents: (selectable ? 'all' : 'none') as const, cursor: 'pointer' },
      onPointerDown: selectable && opts.id ? () => onSelect?.(opts.id!) : undefined,
      'aria-hidden': true as const,
    };
    if (g.kind === 'circle') {
      return (
        <circle
          key={opts.id ?? 'preview'}
          {...common}
          cx={toDomX(g.cx)}
          cy={toDomY(g.cy)}
          r={g.r * effectiveScale}
        />
      );
    }
    if (g.kind === 'rect') {
      return (
        <rect
          key={opts.id ?? 'preview'}
          {...common}
          x={toDomX(g.x)}
          y={toDomY(g.y)}
          width={g.w * effectiveScale}
          height={g.h * effectiveScale}
        />
      );
    }
    const points = g.points.map((p) => `${toDomX(p.x)},${toDomY(p.y)}`).join(' ');
    return <polygon key={opts.id ?? 'preview'} {...common} points={points} />;
  };

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      data-testid="map-aoe-layer"
      role="group"
      aria-label="Spell area-of-effect templates"
    >
      {aoes.map((a) =>
        renderShape(a, a.color, { id: a.id, interactive: !!canModify && canModify(a) })
      )}
      {preview && renderShape(preview, preview.color, { interactive: false })}
    </svg>
  );
}
```

> `z-10` places AoE **below** the drawing layer (`z-20`) and tokens, so tokens/labels stay readable over the tint (per the spec).

- [ ] **Step 2: `tests/components/mainview/tabletop/MapAoELayer.test.tsx`** — render with one of each shape (identity transform: `effectiveScale=1`, offsets `0`) and assert the right SVG element + `data-aoe-shape`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MapAoELayer } from '~/components/mainview/tabletop/MapAoELayer';
import type { MapAoEData } from '~/types/mapAoe';

function aoe(over: Partial<MapAoEData>): MapAoEData {
  return {
    id: 'a',
    mapId: 'm',
    campaignId: 'c',
    shape: 'sphere',
    originX: 100,
    originY: 100,
    sizePx: 40,
    rotation: 0,
    color: '#ff0000',
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('MapAoELayer', () => {
  it('renders a circle for a sphere and a polygon for a cone', () => {
    const { container } = render(
      <MapAoELayer
        visible
        aoes={[aoe({ id: 's', shape: 'sphere' }), aoe({ id: 'k', shape: 'cone' })]}
        preview={null}
        effectiveScale={1}
        imageOffsetX={0}
        imageOffsetY={0}
      />
    );
    expect(container.querySelector('[data-aoe-id="s"]')?.tagName.toLowerCase()).toBe('circle');
    expect(container.querySelector('[data-aoe-id="k"]')?.tagName.toLowerCase()).toBe('polygon');
    expect(container.querySelector('circle')?.getAttribute('fill-opacity')).toBe('0.3');
  });
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <MapAoELayer
        visible={false}
        aoes={[aoe({})]}
        preview={null}
        effectiveScale={1}
        imageOffsetX={0}
        imageOffsetY={0}
      />
    );
    expect(queryByTestId('map-aoe-layer')).toBeNull();
  });
});
```

- [ ] **Step 3:** run the test, typecheck/lint clean. Commit `feat(aoe): render semi-transparent AoE templates (MapAoELayer)`.

---

## Task 7: `useAoeTool` (placement)

**Files:**

- Create: `app/components/mainview/tabletop/useAoeTool.ts`
- Test: `tests/components/mainview/tabletop/useAoeTool.test.tsx`

**Interfaces:**

- Consumes: `domToImage`, `clamp` (`./ActiveMapStage.geometry`), scale + image bounds, the tool's current `shape`/`sizeFt`/`widthFt`/`color`, and `onCommit(aoe)`.
- Produces: `{ preview, onPointerDown, onPointerMove, reset }` — a ruler-style hook. `preview` is an `AoeInput & { color }` (map-local) or null.

- [ ] **Step 1: `app/components/mainview/tabletop/useAoeTool.ts`** — modeled on `useRulerTool` (Esc/reset/short-circuit). State: `origin: {x,y} | null`, `cursor: {x,y} | null`. Radial shapes commit on the first click; cone/line set origin on click 1, aim on move, commit on click 2.

```ts
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp } from './ActiveMapStage.geometry';
import { feetToPixels, type AoeInput } from './aoeGeometry';
import type { AoeShape } from '~/types/mapAoe';

interface Options {
  aoeActive: boolean;
  shape: AoeShape;
  sizeFt: number;
  widthFt: number;
  color: string;
  domToImage: (clientX: number, clientY: number) => { x: number; y: number } | null;
  pixelsPerSquare: number;
  feetPerSquare: number;
  imageWidth: number;
  imageHeight: number;
  onCommit: (aoe: AoeInput & { color: string }) => void;
}

const RADIAL: AoeShape[] = ['sphere', 'cube', 'cylinder'];

export function useAoeTool(o: Options) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setOrigin(null);
    setCursor(null);
  }, []);

  useEffect(() => {
    if (!o.aoeActive) reset();
  }, [o.aoeActive, reset]);

  // Esc cancels an in-progress directional placement.
  useEffect(() => {
    if (!o.aoeActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !origin) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      e.preventDefault();
      reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [o.aoeActive, origin, reset]);

  const sizePx = feetToPixels(o.sizeFt, o);
  const widthPx = o.shape === 'line' ? feetToPixels(o.widthFt, o) : undefined;

  const build = useCallback(
    (ox: number, oy: number, rotation: number): AoeInput & { color: string } => ({
      shape: o.shape,
      originX: ox,
      originY: oy,
      sizePx,
      widthPx,
      rotation,
      color: o.color,
    }),
    [o.shape, o.color, sizePx, widthPx]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const img = o.domToImage(e.clientX, e.clientY);
      if (!img) return;
      const p = { x: clamp(img.x, 0, o.imageWidth), y: clamp(img.y, 0, o.imageHeight) };
      if (RADIAL.includes(o.shape)) {
        o.onCommit(build(p.x, p.y, 0));
        reset();
        return;
      }
      if (!origin) {
        setOrigin(p);
        setCursor(p);
      } else {
        const rotation = Math.atan2(p.y - origin.y, p.x - origin.x);
        o.onCommit(build(origin.x, origin.y, rotation));
        reset();
      }
    },
    [o, origin, build, reset]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!origin) return;
      const img = o.domToImage(e.clientX, e.clientY);
      if (img) setCursor(img);
    },
    [o, origin]
  );

  const preview: (AoeInput & { color: string }) | null = origin
    ? build(origin.x, origin.y, cursor ? Math.atan2(cursor.y - origin.y, cursor.x - origin.x) : 0)
    : null;

  return { preview, onPointerDown, onPointerMove, reset };
}
```

- [ ] **Step 2: `tests/components/mainview/tabletop/useAoeTool.test.tsx`** — drive the hook with `renderHook` + synthetic pointer events; assert:
  - a **sphere** click commits immediately with the right `sizePx`/`originX`;
  - a **cone** first click sets a preview (no commit), a move updates `preview.rotation`, a second click commits with that rotation;
  - Esc after the first cone click clears `preview` and does not commit.
    (Use a `domToImage` stub returning `{x: clientX, y: clientY}` and `onCommit = vi.fn()`.)

- [ ] **Step 3:** run the test, typecheck/lint clean. Commit `feat(aoe): add AoE placement tool (origin + aim, ruler-style)`.

---

## Task 8: Tool UI — `AoeSettingsPanel` + tool registration

**Files:**

- Create: `app/components/mainview/tabletop/AoeSettingsPanel.tsx`
- Modify: `app/components/mainview/tabletop/toolWindowState.ts` (add `'aoe'` to `ToolWindowId`)
- Modify: the tabletop toolbar (add the AoE tool button — find where Draw/Text/Ruler buttons are registered; likely `ToolBar.tsx` / the tool-window opener in `ActiveMapStage`)

**Interfaces:**

- Produces: `AoeSettingsPanel` (`{ shape, onShape, sizeFt, onSizeFt, widthFt, onWidthFt, color, onColor, placing, onTogglePlacing, onClearAll, canClearAll }`); a registered `'aoe'` tool window.

- [ ] **Step 1: `AoeSettingsPanel.tsx`** — clone `DrawingSettingsPanel.tsx`’s structure (shape buttons row, numeric field, `ColorPicker` from `~/components/shared/ColorPicker`). Five shape buttons (sphere/cone/cube/line/cylinder), a **Size (ft)** number input, a **Width (ft)** input shown only when `shape === 'line'`, the `ColorPicker`, a **"Place on map"** toggle button (armed state = `placing`), and a **"Clear all AoE"** button shown only when `canClearAll` (GM). Use the existing panel's tailwind classes.

- [ ] **Step 2:** `toolWindowState.ts` — add `'aoe'` to the `ToolWindowId` union (and any tool list/labels/icons the file defines). Follow the existing `ruler`/`draw`/`text` entries.

- [ ] **Step 3:** Register the toolbar button that opens the `'aoe'` tool window (mirror the Draw/Ruler buttons). Give it a lucide icon (e.g. `Hexagon` or `Cone` — pick an available one). **Ensure it is not GM-gated** — players must see it (contrast the Draw tool if that is GM-only).

- [ ] **Step 4:** typecheck/lint clean; if a `ToolBar`/tool-window test enumerates tools (like `WikiPanel.test.tsx` did), update its expected set. Commit `feat(aoe): add Spell AoE tool window + toolbar entry`.

---

## Task 9: `ActiveMapStage` integration

**Files:**

- Modify: `app/components/mainview/tabletop/ActiveMapStage.tsx`
- (Possibly) Modify: `TabletopView.tsx` if the tool's open-state lives there (as with other tool windows).

**Interfaces:**

- Consumes everything above; wires the tool into the live stage.

- [ ] **Step 1:** Instantiate data + placement: `const { data: aoes = [] } = useMapAoE(campaignId, map.id)`; `const aoeMutations = useMapAoEMutations(campaignId, map.id)`; local tool state `aoeShape/aoeSizeFt/aoeWidthFt/aoeColor/aoePlacing` (or lift to the AoE settings panel). `const aoe = useAoeTool({ aoeActive: aoePlacing, shape, sizeFt, widthFt, color, domToImage, pixelsPerSquare: map.scale.pixelsPerSquare, feetPerSquare: map.scale.feetPerSquare, imageWidth: map.imageWidth, imageHeight: map.imageHeight, onCommit })` where `onCommit` calls `aoeMutations.create.mutate(aoeToCreateInput, { onSuccess: (res) => { applyAoeAddToCache(qc, campaignId, map.id, res.aoe); onBroadcast({ type: 'aoe:added', mapId: map.id, aoe: res.aoe }); } })`. Convert the placement `AoeInput` (map-local px) directly to the create payload.

- [ ] **Step 2:** Short-circuit pointer handlers **before** pan/ruler, mirroring the ruler wiring (`ActiveMapStage.tsx` ~`:628-643`, `:971-974`, `:1307-1313`): when `aoePlacing`, route `onPanPointerDown`→`aoe.onPointerDown`, `onPointerMove`→`aoe.onPointerMove`, and `onDoubleClick`→`aoe.reset()`. Ensure ruler and AoE placement are mutually exclusive (only one tool armed).

- [ ] **Step 3:** Render `<MapAoELayer visible={showSpellEffects} aoes={aoes} preview={aoe.preview} effectiveScale={effectiveScale} imageOffsetX={imageOffsetX} imageOffsetY={imageOffsetY} currentUserId={currentUserId} isGM={isGM} selectedId={selectedAoeId} onSelect={setSelectedAoeId} canModify={(a) => isGM || a.createdBy === currentUserId} />` in the compositing order **just above the grid, below `MapDrawingLayer`** (per the spec).

- [ ] **Step 4:** Delete + clear: a keydown handler removes `selectedAoeId` when set (calling `aoeMutations.remove` + `applyAoeRemoveFromCache` + `onBroadcast({type:'aoe:removed', ...})`) — only when `canModify`. Wire the panel's `onClearAll` (GM) to `aoeMutations.clear` + `applyAoeClearToCache` + `onBroadcast({type:'aoe:cleared', mapId})`.

- [ ] **Step 5:** Render the `AoeSettingsPanel` inside a `ToolWindow` when the `'aoe'` tool is open (mirror how `LayersPanel`/`DrawingSettingsPanel` are hosted at `ActiveMapStage.tsx:1504-1518`).

- [ ] **Step 6:** `npm run typecheck && npm run lint` clean; `npm test` green (run the tabletop suite). Manually confirm nothing regressed in ruler/draw. Commit `feat(aoe): wire the Spell AoE tool into the tabletop stage`.

---

## Task 10: e2e + gates + dev

**Files:**

- Create: `e2e/spell-aoe.spec.ts` (follow existing tabletop e2e patterns/fixtures)

- [ ] **Step 1:** e2e (adapt to the real harness): as a GM in a seeded campaign, open the tabletop → open the **Spell AoE** tool → pick **sphere**, size 20 → click the map → assert a `[data-testid="map-aoe"]` circle appears. Toggle the zoom toolbar's spell-effects control off → it disappears. (Selectors/fixtures per the repo's tabletop e2e.)

- [ ] **Step 2: Full gates:** `npm test`, `npm run typecheck`, `npm run lint` all clean.

- [ ] **Step 3: Manual multiplayer check** (the whole point): with `npm run dev` (web + ws) running and the dev DB seeded, place an AoE as one user and confirm it appears for a second connected client. Reset dev per the `resetting-dev-data` skill if needed (no data regeneration required — Phase 3 adds a collection, not spell data).

- [ ] **Step 4:** Open a PR to `dev` (never `main`).

## Self-Review (author checklist)

- [ ] **Spec coverage:** model+auth (T1,T3), geometry+scaling (T2), shared persistence/broadcast NOT GM-gated (T4,T5), semi-transparent render (T6), placement w/ aim+Esc (T7), tool UI + player-accessible (T8), stage wiring + delete-own/GM-clear (T9), e2e (T10).
- [ ] **Type consistency:** `MapAoEData`/`AoeInput`/`AoeShape` and `applyAoe*ToCache` names identical across tasks; `aoe:*` message shapes match between party union (T5) and the broadcasts in the stage (T9).
- [ ] **No new deps.** Tests under `tests/`. AoE is on the **text** (shared) sync path, not the drawing GM-gate.

## Out of scope (this plan)

- Drag-resize/move of placed templates; grid snapping; auto-fill from a spell's `areaOfEffect`; range enforcement; non-square grids (fall back to a default scale).
