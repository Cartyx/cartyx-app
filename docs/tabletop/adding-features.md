# Adding Features

This guide covers the common extension patterns for the tabletop system.

## Adding a New Map Tool

Drawing, text, ruler and spell-AoE tools are all shipped — copy one rather than
starting from scratch. The drawing tool is the fullest example. The pattern:

1. **Register the tool** in `app/components/mainview/ToolBar.tsx` (`ToolType`,
   plus `gmOnly: true` if it is GM-restricted) and, if it opens a panel, in
   `toolWindowState.ts` (`ToolWindowId` + `TOOL_WINDOW_META`). Tools in
   `MODAL_TOOLS` also become a map mode; those in `WINDOW_ONLY_TOOLS` are just
   window toggles.

2. **Write the interaction hook** next to `ActiveMapStage` — see `useAoeTool.ts`
   or `useRulerTool.ts`. It takes DOM pointer events (not Konva: the map surface
   is plain DOM), converts through `domToImage`, and calls `onCommit` with
   map-local coordinates.

3. **Render the overlay** as an SVG layer, modelled on `MapDrawingLayer.tsx` or
   `MapAoELayer.tsx`, and place it in the compositing order inside
   `ActiveMapStage.tsx`. Give it a per-viewer visibility toggle in the zoom
   toolbar unless it genuinely belongs on a Layers-panel layer.

4. **Persist it** as its own collection keyed by `mapId` — see
   `app/server/db/models/MapDrawing.ts` and `app/server/functions/mapDrawings.ts`
   with a Zod schema under `app/types/schemas/`. Do **not** add a subdocument
   array to `TabletopScreen`; map contents are not screen contents.

5. **Broadcast it** on the `tabletop_map` party (see below).

## Adding a New Layer

Layers-panel layers live in `MAP_LAYERS` (`app/types/mapLayer.ts`), ordered
highest → lowest. Adding one means:

1. **Add the entry** to `MAP_LAYERS`. `MapLayerId` derives from the array, so the
   type follows automatically. Mark `placeholder: true` if the authoring tools
   don't exist yet (this is what Fog of War does).

2. **Gate rendering** on `!hiddenLayers.has('<id>')` in `ActiveMapStage.tsx`, at
   the right point in the compositing order.

3. **Derive membership where possible.** Token layers compute `gm-private` vs
   `public` from `hiddenFromPlayers` via `tokenLayerId()` rather than storing a
   parallel `layer` field — prefer that over a new persisted column.

Note the Layers panel is GM-only, and `hiddenLayers` is local, per-viewer state:
hiding a layer changes what the GM sees, not what players see. If what you want
is a per-viewer show/hide for everyone, add a zoom-toolbar toggle instead — that
is what spell effects, drawings and text do.

For worked examples see `MapDrawingLayer.tsx` (freehand/shape drawing) or
`MapToken.tsx` (a single positioned token), both rendered from
`ActiveMapStage.tsx`.

## Adding a New Realtime Message Type

First pick the party — the three behave differently (see
[real-time-sync.md](./real-time-sync.md)):

- **`tabletop`** — tabs and windows. Union: `TabletopMessage` in
  `app/types/tabletop.ts`.
- **`tabletop_map`** — map contents (tokens, drawings, text, AoE). Union in
  `app/hooks/useTabletopMapParty.ts`.
- **`main`** — chat, dice, spell cards. Validated and persisted.

1. **Extend the union** for that party:

   ```typescript
   export type TabletopMessage = {
     type: 'tab:pin';
     screenId: string;
   };
   // ... existing types
   ```

2. **Handle on receive** — `TabletopView.handleMessage` for `tabletop`;
   `useTabletopMapSync` / `ActiveMapStage` for `tabletop_map`.

   ```typescript
   case 'tab:pin':
     // Update local state or invalidate a query
     break;
   ```

3. **Send from the UI** using the `send()` returned by the party's hook:

   ```typescript
   send({ type: 'tab:pin', screenId });
   ```

4. **Update the server if the type is restricted.** The relay is not a
   transparent pipe. A GM-only type must be added to `GM_ONLY_MESSAGE_TYPES` in
   `realtime/src/parties/tabletop.ts` or `tabletopMap.ts`, or any player can
   forge it. A `main`-party type must be added to `VALID_TYPES` plus its
   validation in `realtime/src/parties/session.ts`. Only genuinely unrestricted
   types need no server change.

## Adding a New Server Function

Follow this pattern: **Zod schema -> server function -> hook -> query key**.

### 1. Zod Schema

Add the input schema to `app/types/schemas/tabletop.ts`:

```typescript
export const moveTokenSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  tokenId: z.string().trim().min(1),
  x: z.number(),
  y: z.number(),
});
```

### 2. Server Function

Add the function to `app/server/functions/tabletop.ts`:

```typescript
export const moveToken = createServerFn({ method: 'POST' })
  .inputValidator(moveTokenSchema)
  .handler(async ({ data }) => {
    const member = await requireCampaignMember(data.campaignId);
    // ... Mongoose update logic
    return { success: true };
  });
```

Key patterns from existing code:

- Use `requireCampaignGM()` for GM-only actions.
- Use `requireCampaignMember()` for actions any member can perform.
- Wrap Mongoose calls in try/catch and call `serverCaptureException` on error.
- Use `serverCaptureEvent` for analytics tracking.

### 3. React Query Hook

Add the RPC wrapper and hook to `app/hooks/useTabletopScreens.ts`:

```typescript
const moveTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(moveTokenSchema)
  .handler(async ({ data }) => {
    const { moveToken } = await import('~/server/functions/tabletop');
    return moveToken({ data });
  });
```

Then add a `useMutation` inside `useTabletopMutations`:

```typescript
const moveTokenMutation = useMutation({
  mutationFn: (params: { screenId: string; tokenId: string; x: number; y: number }) =>
    moveTokenFn({ data: { screenId, campaignId, ...params } }),
  onSuccess: (_data, vars) => {
    invalidateDetail(vars.screenId);
  },
});
```

### 4. Query Key

If you need a new query (not just a mutation), add a key to
`app/utils/queryKeys.ts`:

```typescript
tabletop: {
  // ... existing keys
  tokens: (campaignId: string, screenId: string) =>
    ['tabletop', 'tokens', campaignId, screenId] as const,
},
```

## Adding a New Wiki Collection to Windows

To make a new collection type showable on the tabletop:

1. **Add the collection name** to the `TABLETOP_COLLECTIONS` tuple in
   `app/types/schemas/tabletop.ts`.

2. **Add a fetcher** to the `COLLECTION_REGISTRY` in
   `app/server/functions/tabletop-hydration.ts`:

   ```typescript
   myCollection: {
     async fetch(ids: string[], campaignId: string) {
       return MyModel.find({ _id: { $in: ids }, campaignId }, '_id title content')
         .lean()
         .then(docs => docs.map(d => ({
           _id: d._id,
           title: d.title,
           content: d.content,
         })));
     },
   },
   ```

3. **Add the ShowOnTabletopButton** to the wiki view for that collection. See
   `app/components/wiki/shared/ShowOnTabletopButton.tsx` for the pattern.

## Testing Checklist

For any new tabletop feature, verify:

- [ ] **Types:** New types added to `app/types/tabletop.ts`
- [ ] **Schema:** Zod schema added to `app/types/schemas/tabletop.ts`
- [ ] **Server function:** Added with proper auth checks (GM vs member)
- [ ] **Error tracking:** `serverCaptureException` called in catch blocks
- [ ] **Hook:** RPC wrapper uses `await import()` for server-only code
- [ ] **Query invalidation:** Mutations invalidate the correct query keys
- [ ] **Real-time:** message type added to the right party if other clients need updates
- [ ] **Permissions:** UI hides GM-only controls when `isGM` is false
- [ ] **Permissions:** Server enforces `requireCampaignGM` for GM-only mutations
- [ ] **Permissions:** GM-only message types added to the party's `GM_ONLY_MESSAGE_TYPES`
- [ ] **E2E test:** Playwright test covers the happy path in `e2e/tabletop/`
