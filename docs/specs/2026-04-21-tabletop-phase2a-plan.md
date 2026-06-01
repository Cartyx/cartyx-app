# Tabletop Phase 2A: Locations Wiki — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Locations wiki section with hierarchical location types, parent/child linking, public/private visibility, markdown descriptions, GM notes, drag-and-drop to tabletop/GM screens, and search/filter. Map image upload is included but map rendering is deferred to Phase 2B.

**Architecture:** Follows the existing wiki pattern exactly (Rules section as reference). Location and LocationType are new MongoDB collections. LocationType has seeded defaults that GMs can extend. Locations support parent/child hierarchy for world-building (continent → country → city). The wiki UI matches the existing panels (search, tags, cards, modals). Locations integrate into floating windows on both GM Screens and Tabletop via the existing collection registry.

**Tech Stack:** React 19, TanStack React Query, TanStack React Start (server functions), MongoDB/Mongoose, Zod, Vitest

---

## File Structure

### New Files

| Path                                                      | Responsibility                                           |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `app/types/location.ts`                                   | TypeScript interfaces for Location and LocationType data |
| `app/types/schemas/locations.ts`                          | Zod validation schemas for location server functions     |
| `app/server/db/models/Location.ts`                        | Mongoose model for Location                              |
| `app/server/db/models/LocationType.ts`                    | Mongoose model for LocationType with seeded defaults     |
| `app/server/functions/locations.ts`                       | Server functions for Location CRUD                       |
| `app/server/functions/location-types.ts`                  | Server functions for LocationType CRUD                   |
| `app/hooks/useLocations.ts`                               | React Query hooks for locations                          |
| `app/hooks/useLocationTypes.ts`                           | React Query hooks for location types                     |
| `app/components/wiki/locations/LocationsPanel.tsx`        | Main panel with search, filters, list                    |
| `app/components/wiki/locations/LocationCard.tsx`          | Draggable card in list view                              |
| `app/components/wiki/locations/LocationModal.tsx`         | Create/edit modal (GM only)                              |
| `app/components/wiki/locations/LocationViewModal.tsx`     | Read-only view modal (players)                           |
| `app/components/wiki/locations/LocationWindow.tsx`        | Display component for floating windows                   |
| `app/components/wiki/locations/LocationWindowWrapper.tsx` | Wrapper with loading/error states for floating windows   |
| `app/components/wiki/locations/LocationTypeManager.tsx`   | Inline UI for GM to manage location types                |
| `tests/server/functions/locations.test.ts`                | Schema validation tests                                  |

### Modified Files

| Path                                                  | Change                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| `app/components/wiki/WikiPanel.tsx`                   | Add "Locations" category with MapPin icon         |
| `app/utils/queryKeys.ts`                              | Add `locations` and `locationTypes` key factories |
| `app/types/schemas/gmscreens.ts`                      | Add `'location'` to SUPPORTED_COLLECTIONS         |
| `app/types/schemas/tabletop.ts`                       | Add `'location'` to TABLETOP_COLLECTIONS          |
| `app/server/functions/tabletop-hydration.ts`          | Add `location` to COLLECTION_REGISTRY             |
| `app/server/functions/gmscreens.ts`                   | Add `location` to COLLECTION_REGISTRY             |
| `app/components/mainview/gmscreens/GMScreensView.tsx` | Add LocationWindowWrapper case                    |
| `app/components/mainview/tabletop/TabletopView.tsx`   | Add LocationWindowWrapper case                    |

---

## Task 1: TypeScript Types

**Files:**

- Create: `app/types/location.ts`

- [ ] **Step 1: Create location types**

Create `app/types/location.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add app/types/location.ts
git commit -m "feat(locations): add TypeScript types for Location and LocationType"
```

---

## Task 2: Zod Schemas & Query Keys

**Files:**

- Create: `app/types/schemas/locations.ts`
- Modify: `app/utils/queryKeys.ts`

- [ ] **Step 1: Create Zod schemas**

Create `app/types/schemas/locations.ts`:

```typescript
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Location CRUD
// ---------------------------------------------------------------------------

export const listLocationsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().optional(),
  visibility: z.enum(['all', 'public', 'private']).optional().default('all'),
  locationType: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const getLocationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const createLocationSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Location name is required'),
  locationType: z.string().trim().min(1, 'Location type is required'),
  description: z.string().optional().default(''),
  gmNotes: z.string().optional().default(''),
  isPublic: z.boolean().optional().default(true),
  parentLocations: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export const updateLocationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Location name is required'),
  locationType: z.string().trim().min(1, 'Location type is required'),
  description: z.string().optional().default(''),
  gmNotes: z.string().optional().default(''),
  isPublic: z.boolean().optional(),
  parentLocations: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export const deleteLocationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// LocationType CRUD
// ---------------------------------------------------------------------------

export const listLocationTypesSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const createLocationTypeSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Type name is required'),
});

export const deleteLocationTypeSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});
```

- [ ] **Step 2: Add query keys**

Add to `app/utils/queryKeys.ts` inside the `queryKeys` object:

```typescript
  locations: {
    all: ['locations'] as const,
    list: (campaignId: string, search?: string, visibility?: string, locationType?: string, tags?: string[]) =>
      ['locations', 'list', campaignId, search ?? '', visibility ?? 'all', locationType ?? '', tags ?? []] as const,
    detail: (id: string, campaignId?: string) =>
      ['locations', 'detail', campaignId ?? '', id] as const,
  },
  locationTypes: {
    all: ['locationTypes'] as const,
    list: (campaignId: string) => ['locationTypes', 'list', campaignId] as const,
  },
```

- [ ] **Step 3: Commit**

```bash
git add app/types/schemas/locations.ts app/utils/queryKeys.ts
git commit -m "feat(locations): add Zod schemas and query keys"
```

---

## Task 3: MongoDB Models

**Files:**

- Create: `app/server/db/models/Location.ts`
- Create: `app/server/db/models/LocationType.ts`

- [ ] **Step 1: Create Location model**

Create `app/server/db/models/Location.ts` — follow the Rule.ts pattern:

```typescript
import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: { type: String, required: true },
    locationType: { type: String, required: true },
    description: { type: String, default: '' },
    gmNotes: { type: String, default: '' },
    isPublic: { type: Boolean, default: true },
    parentLocations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    childLocations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    mapImage: { type: String, default: null },
    mapBounds: {
      type: new mongoose.Schema(
        {
          north: { type: Number, required: true },
          south: { type: Number, required: true },
          east: { type: Number, required: true },
          west: { type: Number, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    tags: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'location' }
);

locationSchema.index({ campaignId: 1, updatedAt: -1 });
locationSchema.index({ campaignId: 1, locationType: 1 });
locationSchema.index({ campaignId: 1, isPublic: 1 });
locationSchema.index({ tags: 1 });
locationSchema.index({ name: 'text', description: 'text' });

export const Location = mongoose.models.Location || mongoose.model('Location', locationSchema);
```

- [ ] **Step 2: Create LocationType model with seeded defaults**

Create `app/server/db/models/LocationType.ts`:

```typescript
import mongoose from 'mongoose';

export const DEFAULT_LOCATION_TYPES = [
  'continent',
  'country',
  'region',
  'state',
  'province',
  'city',
  'town',
  'village',
  'cave',
  'dungeon',
  'planet',
] as const;

const locationTypeSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    name: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { collection: 'locationtype' }
);

locationTypeSchema.index({ campaignId: 1, name: 1 }, { unique: true });
locationTypeSchema.index({ campaignId: 1, sortOrder: 1 });

export const LocationType =
  mongoose.models.LocationType || mongoose.model('LocationType', locationTypeSchema);

/**
 * Seed default location types for a campaign if none exist.
 * Called on first listLocationTypes request.
 */
export async function seedDefaultLocationTypes(campaignId: string): Promise<void> {
  const count = await LocationType.countDocuments({ campaignId });
  if (count > 0) return;

  const docs = DEFAULT_LOCATION_TYPES.map((name, i) => ({
    campaignId,
    name,
    isDefault: true,
    sortOrder: i,
  }));

  await LocationType.insertMany(docs);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/server/db/models/Location.ts app/server/db/models/LocationType.ts
git commit -m "feat(locations): add MongoDB models for Location and LocationType"
```

---

## Task 4: Server Functions — Location CRUD

**Files:**

- Create: `app/server/functions/locations.ts`
- Create: `tests/server/functions/locations.test.ts`

- [ ] **Step 1: Write schema validation tests**

Create `tests/server/functions/locations.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('location schemas', () => {
  it('createLocationSchema rejects empty name', async () => {
    const { createLocationSchema } = await import('~/types/schemas/locations');
    const result = createLocationSchema.safeParse({
      campaignId: 'abc',
      name: '',
      locationType: 'city',
    });
    expect(result.success).toBe(false);
  });

  it('createLocationSchema rejects missing locationType', async () => {
    const { createLocationSchema } = await import('~/types/schemas/locations');
    const result = createLocationSchema.safeParse({
      campaignId: 'abc',
      name: 'Waterdeep',
      locationType: '',
    });
    expect(result.success).toBe(false);
  });

  it('createLocationSchema accepts valid input', async () => {
    const { createLocationSchema } = await import('~/types/schemas/locations');
    const result = createLocationSchema.safeParse({
      campaignId: 'abc',
      name: 'Waterdeep',
      locationType: 'city',
      description: 'A great city',
      isPublic: true,
      parentLocations: ['parent1'],
      tags: ['forgotten-realms'],
    });
    expect(result.success).toBe(true);
  });

  it('listLocationsSchema accepts locationType filter', async () => {
    const { listLocationsSchema } = await import('~/types/schemas/locations');
    const result = listLocationsSchema.safeParse({
      campaignId: 'abc',
      locationType: 'city',
    });
    expect(result.success).toBe(true);
  });

  it('createLocationTypeSchema rejects empty name', async () => {
    const { createLocationTypeSchema } = await import('~/types/schemas/locations');
    const result = createLocationTypeSchema.safeParse({
      campaignId: 'abc',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('createLocationTypeSchema accepts valid input', async () => {
    const { createLocationTypeSchema } = await import('~/types/schemas/locations');
    const result = createLocationTypeSchema.safeParse({
      campaignId: 'abc',
      name: 'island',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/server/functions/locations.test.ts`
Expected: All 6 tests pass

- [ ] **Step 3: Create location server functions**

Create `app/server/functions/locations.ts` — follow the EXACT pattern from `app/server/functions/rules.ts` for auth, serialization, error handling, PostHog events. Key differences from rules:

- **listLocations**: Supports `locationType` filter in addition to search/visibility/tags. Visibility filtering follows the spec: if `isPublic: false`, only creator + GMs see it. List returns `canEdit` per item (`isOwner || isGM`).
- **getLocation**: Returns full LocationData including `gmNotes` (only if GM or creator), `description`, parent/child locations. Filter `gmNotes` to empty string for non-owners/non-GMs.
- **createLocation**: GM only. After creating, update parent locations' `childLocations` arrays to include the new location ID.
- **updateLocation**: GM or creator only. Sync parent/child relationships (remove from old parents' childLocations, add to new parents' childLocations).
- **deleteLocation**: GM or creator only. Clean up parent/child references. Call `removeDocumentRefsFromScreens` to clean GM screen/tabletop references.

READ `app/server/functions/rules.ts` for the exact auth pattern (`requireCampaignMember` returns `{ userId, isGM, sessionUserId }`).

- [ ] **Step 4: Create location type server functions**

Create `app/server/functions/location-types.ts`:

- **listLocationTypes**: Any member can list. Calls `seedDefaultLocationTypes` on first request. Returns sorted by `sortOrder`.
- **createLocationType**: GM only. Sets `isDefault: false`, `sortOrder` = max + 1.
- **deleteLocationType**: GM only. Only delete if `isDefault: false` (can't delete system types). Check no locations use this type before deleting.

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/locations.ts app/server/functions/location-types.ts tests/server/functions/locations.test.ts
git commit -m "feat(locations): add server functions for Location and LocationType CRUD"
```

---

## Task 5: React Query Hooks

**Files:**

- Create: `app/hooks/useLocations.ts`
- Create: `app/hooks/useLocationTypes.ts`

- [ ] **Step 1: Create useLocations hook**

Create `app/hooks/useLocations.ts` — follow the EXACT pattern from `app/hooks/useRules.ts`:

- Server function wrappers with dynamic imports from `~/server/functions/locations`
- `useLocations(campaignId, filters?)` — useQuery with queryKeys.locations.list
- `useLocation(id, campaignId)` — useQuery with queryKeys.locations.detail
- `useCreateLocation()` — useMutation, invalidates list + tags
- `useUpdateLocation()` — useMutation, invalidates list + detail + gmscreens.all + tabletop.all
- `useDeleteLocation()` — useMutation, invalidates list, removes detail queries

READ `app/hooks/useRules.ts` for the exact pattern.

- [ ] **Step 2: Create useLocationTypes hook**

Create `app/hooks/useLocationTypes.ts`:

- `useLocationTypes(campaignId)` — useQuery
- `useCreateLocationType()` — useMutation, invalidates list
- `useDeleteLocationType()` — useMutation, invalidates list

- [ ] **Step 3: Commit**

```bash
git add app/hooks/useLocations.ts app/hooks/useLocationTypes.ts
git commit -m "feat(locations): add React Query hooks for locations and location types"
```

---

## Task 6: Collection Registry Updates

**Files:**

- Modify: `app/types/schemas/gmscreens.ts`
- Modify: `app/types/schemas/tabletop.ts`
- Modify: `app/server/functions/tabletop-hydration.ts`
- Modify: `app/server/functions/gmscreens.ts`

- [ ] **Step 1: Add 'location' to supported collections**

In `app/types/schemas/gmscreens.ts`, add `'location'` to `SUPPORTED_COLLECTIONS`.

In `app/types/schemas/tabletop.ts`, add `'location'` to `TABLETOP_COLLECTIONS`.

- [ ] **Step 2: Add location fetcher to hydration registries**

In `app/server/functions/tabletop-hydration.ts`, add a `location` entry to `COLLECTION_REGISTRY`:

```typescript
location: {
  async fetch(ids, campaignId) {
    const { Location } = await import('../db/models/Location');
    return Location.find({ _id: { $in: ids }, campaignId }, '_id name description isPublic')
      .lean()
      .then((docs) =>
        docs.map((d) => ({
          _id: d._id,
          title: (d as { name?: string }).name,
          content: (d as { description?: string }).description,
          isPublic: (d as { isPublic?: boolean }).isPublic,
        }))
      );
  },
},
```

In `app/server/functions/gmscreens.ts`, add the same `location` entry to its `COLLECTION_REGISTRY`.

- [ ] **Step 3: Commit**

```bash
git add app/types/schemas/gmscreens.ts app/types/schemas/tabletop.ts app/server/functions/tabletop-hydration.ts app/server/functions/gmscreens.ts
git commit -m "feat(locations): register location collection for GM Screens and Tabletop windows"
```

---

## Task 7: Location UI Components

**Files:**

- Create: `app/components/wiki/locations/LocationCard.tsx`
- Create: `app/components/wiki/locations/LocationWindow.tsx`
- Create: `app/components/wiki/locations/LocationWindowWrapper.tsx`

- [ ] **Step 1: Create LocationCard**

Create `app/components/wiki/locations/LocationCard.tsx` — follow `RuleCard.tsx` exactly:

- Draggable with `application/x-cartyx-document` MIME type, collection = `'location'`
- Shows name, locationType badge, isPublic icon (Globe/Lock), tags
- Shows parent location name if available (e.g., "Waterdeep · City · in Sword Coast")
- `cursor-grab active:cursor-grabbing` classes
- Keyboard accessible (Enter/Space)

- [ ] **Step 2: Create LocationWindow**

Create `app/components/wiki/locations/LocationWindow.tsx` — display component for floating windows:

- Shows location name, type badge, public/private icon
- Tabs: General (description markdown), GM Notes (GM only, with amber warning), Hierarchy (parent/child list)
- Uses TabBar, ReactMarkdown, MARKDOWN_PROSE_CLASSES
- Edit button prop (optional)

- [ ] **Step 3: Create LocationWindowWrapper**

Create `app/components/wiki/locations/LocationWindowWrapper.tsx` — follows `PlayerWindowWrapper.tsx`:

```typescript
export function LocationWindowWrapper({ locationId, campaignId, onEdit }) {
  const { location, isLoading } = useLocation(locationId, campaignId);
  // Loading spinner, not found state, or <LocationWindow>
}

export function EditLocationModalWrapper({ campaignId, locationId, onClose }) {
  return <LocationModal isOpen onClose={onClose} campaignId={campaignId} locationId={locationId} />;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/components/wiki/locations/
git commit -m "feat(locations): add LocationCard, LocationWindow, and LocationWindowWrapper"
```

---

## Task 8: Location Modals

**Files:**

- Create: `app/components/wiki/locations/LocationModal.tsx`
- Create: `app/components/wiki/locations/LocationViewModal.tsx`

- [ ] **Step 1: Create LocationModal (create/edit)**

Create `app/components/wiki/locations/LocationModal.tsx` — follow `RuleModal.tsx` pattern:

- Form fields: name (FormInput), locationType (FormSelect populated from useLocationTypes), description (MarkdownEditor), gmNotes (MarkdownEditor, GM only), isPublic toggle, parentLocations (multi-select from existing locations), tags (TagAutocompleteInput)
- ShowOnTabletopButton in header (GM only, edit mode only)
- Delete confirmation flow (edit mode only)
- Escape key to close
- Portal rendering

- [ ] **Step 2: Create LocationViewModal (read-only)**

Create `app/components/wiki/locations/LocationViewModal.tsx` — follow `RuleViewModal.tsx`:

- Shows LocationWindow content in a portal modal
- ShowOnTabletopButton in header
- Close button
- Read-only (no edit)

- [ ] **Step 3: Commit**

```bash
git add app/components/wiki/locations/LocationModal.tsx app/components/wiki/locations/LocationViewModal.tsx
git commit -m "feat(locations): add LocationModal and LocationViewModal"
```

---

## Task 9: LocationsPanel & LocationType Manager

**Files:**

- Create: `app/components/wiki/locations/LocationsPanel.tsx`
- Create: `app/components/wiki/locations/LocationTypeManager.tsx`

- [ ] **Step 1: Create LocationTypeManager**

Create `app/components/wiki/locations/LocationTypeManager.tsx` — small inline component:

- Lists current location types with delete button (only for non-default types)
- Inline form to add new type (input + "Add" button)
- Used inside the LocationsPanel filter area (GM only)

- [ ] **Step 2: Create LocationsPanel**

Create `app/components/wiki/locations/LocationsPanel.tsx` — follow `RulesPanel.tsx` exactly:

- Uses WikiCategoryHeader with "Locations" title and onBack
- WikiFilterBar with search, tags, locationType dropdown filter (populated from useLocationTypes)
- `showVisibilityFilter={isGM}` (GMs can filter by public/private)
- `showSessionFilter={false}` (locations aren't session-specific)
- LocationCard list with loading/error/empty states
- GM click → LocationModal (edit), Player click → LocationViewModal (read-only)
- GM gets "+" create button
- Optional: LocationTypeManager accessible via a small "Manage Types" link (GM only)

- [ ] **Step 3: Commit**

```bash
git add app/components/wiki/locations/LocationsPanel.tsx app/components/wiki/locations/LocationTypeManager.tsx
git commit -m "feat(locations): add LocationsPanel with search, filters, and type management"
```

---

## Task 10: WikiPanel Integration

**Files:**

- Modify: `app/components/wiki/WikiPanel.tsx`

- [ ] **Step 1: Add Locations category**

In `app/components/wiki/WikiPanel.tsx`:

1. Import `MapPin` from lucide-react
2. Import `LocationsPanel` from `~/components/wiki/locations/LocationsPanel`
3. Add to `WIKI_CATEGORIES` array: `{ id: 'locations', label: 'Locations', icon: MapPin }`
4. Add `WikiCategoryId` type to include `'locations'`
5. Add render case: `selectedCategory === 'locations' ? <LocationsPanel onBack={...} />`

- [ ] **Step 2: Commit**

```bash
git add app/components/wiki/WikiPanel.tsx
git commit -m "feat(locations): add Locations tab to WikiPanel"
```

---

## Task 11: Window Wrapper Integration (GM Screens + Tabletop)

**Files:**

- Modify: `app/components/mainview/gmscreens/GMScreensView.tsx`
- Modify: `app/components/mainview/tabletop/TabletopView.tsx`

- [ ] **Step 1: Add LocationWindowWrapper to GM Screens**

In `app/components/mainview/gmscreens/GMScreensView.tsx`:

1. Import `LocationWindowWrapper` and `EditLocationModalWrapper` from `~/components/wiki/locations/LocationWindowWrapper`
2. Add `editingLocationId` state
3. Add `else if (w.collection === 'location')` case in the window content builder
4. Add `EditLocationModalWrapper` render at the bottom with the other editing modals

- [ ] **Step 2: Add LocationWindowWrapper to Tabletop**

In `app/components/mainview/tabletop/TabletopView.tsx`:

Same changes as GM Screens.

- [ ] **Step 3: Commit**

```bash
git add app/components/mainview/gmscreens/GMScreensView.tsx app/components/mainview/tabletop/TabletopView.tsx
git commit -m "feat(locations): add location floating windows to GM Screens and Tabletop"
```

---

## Task 12: Build Verification & Test Fixes

**Files:**

- Possibly modify test files that break due to new imports

- [ ] **Step 1: Run full build**

Run: `npm run build`
Fix any TypeScript errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --project unit`
Fix any test failures (likely need to add `useLocationTypes` / `useLocations` mocks to existing test files that render components importing LocationWindowWrapper).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(locations): resolve build and test issues"
```

---

## Summary

This plan implements Phase 2A (Locations Wiki) in 12 tasks:

1. **Types** — LocationData, LocationTypeData interfaces
2. **Schemas & Keys** — Zod validation, query key factories
3. **Models** — Location + LocationType Mongoose models with seeded defaults
4. **Server Functions** — Location CRUD with hierarchy sync, LocationType CRUD
5. **Hooks** — React Query hooks for locations and location types
6. **Collection Registry** — Register `location` in GM Screens and Tabletop
7. **UI Components** — LocationCard (draggable), LocationWindow, LocationWindowWrapper
8. **Modals** — LocationModal (create/edit), LocationViewModal (read-only)
9. **Panel** — LocationsPanel with search/filter/type management
10. **WikiPanel** — Add Locations tab
11. **Window Wrappers** — Integrate into GM Screens and Tabletop floating windows
12. **Build Verification** — Fix any build/test issues

Each task produces a working commit. Tasks 1-5 are backend/data, tasks 6-11 are frontend, task 12 is verification.
