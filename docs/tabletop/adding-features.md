# Adding Features

This guide covers the common extension patterns for the tabletop system.

## Adding a New Drawing Tool

Drawing tools will be implemented in Phase 3. The pattern will be:

1. **Define the tool** in `app/types/tabletop.ts`:

   ```typescript
   export const DRAWING_TOOLS = ['pen', 'line', 'rect', 'circle', 'eraser'] as const;
   export type DrawingTool = (typeof DRAWING_TOOLS)[number];
   ```

2. **Create the tool component** in `app/components/mainview/tabletop/tools/`:
   - Accept canvas coordinates from Konva pointer events.
   - Render preview shapes on a dedicated drawing `<Layer>`.
   - On completion, emit the final shape data.

3. **Add a PartyKit message** (see "Adding a New Message Type" below) to broadcast
   the drawn shape to other clients.

4. **Persist on the server** by adding a `drawings[]` subdocument array to the
   `TabletopScreen` model (similar to how `windows[]` works).

5. **Add the toolbar** in `TabletopCanvas` to switch between tools.

## Adding a New Layer

Layers are Konva `<Layer>` components stacked inside the `<Stage>`.

1. **Create the layer component** in `app/components/mainview/tabletop/`:

   ```
   FogOfWarLayer.tsx
   TokenLayer.tsx
   DrawingLayer.tsx
   ```

2. **Insert it in the Stage** at the correct position in `TabletopCanvas`. The
   render order determines the visual stacking (first = bottom):

   ```tsx
   <Stage width={w} height={h}>
     <BaseLayer /> {/* 1. grid/map */}
     <GMHiddenLayer /> {/* 2. GM-only annotations */}
     <FogOfWarLayer /> {/* 3. reveal/hide regions */}
     <DrawingLayer /> {/* 4. freehand, shapes */}
     <TokenLayer /> {/* 5. character tokens */}
     <PingOverlay /> {/* 6. ephemeral UI */}
   </Stage>
   ```

3. **Control visibility** per role. GM-only layers check the `isGM` prop and
   skip rendering for players.

4. **Wire data** from the screen detail. If the layer needs persisted data, add
   the corresponding subdocument array to `TabletopScreen` and update the
   hydration logic.

## Adding a New PartyKit Message Type

1. **Extend the union** in `app/types/tabletop.ts`:

   ```typescript
   export type TabletopMessage = {
     type: 'token:move';
     screenId: string;
     tokenId: string;
     x: number;
     y: number;
   };
   // ... existing types
   ```

2. **Handle on receive** in `TabletopView.handleMessage`:

   ```typescript
   case 'token:move':
     // Update local state or invalidate a query
     break;
   ```

3. **Send from the UI** using the `send()` function returned by `useTabletopParty`:

   ```typescript
   send({ type: 'token:move', screenId, tokenId, x: newX, y: newY });
   ```

4. **No server changes needed** -- the PartyKit server is a transparent relay.

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
- [ ] **Real-time:** PartyKit message type added if other clients need updates
- [ ] **Permissions:** UI hides GM-only controls when `isGM` is false
- [ ] **Permissions:** Server enforces `requireCampaignGM` for GM-only mutations
- [ ] **E2E test:** Playwright test covers the happy path in `e2e/tabletop/`
