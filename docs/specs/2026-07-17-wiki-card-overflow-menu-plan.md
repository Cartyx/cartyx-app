# Wiki Card Overflow Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every wiki card an overflow menu with Edit / Show on Tab / Push to Tabletop / Delete, so a GM no longer has to drag a card onto the surface and any member can privately display an item.

**Architecture:** A presentational `OverflowMenu` primitive plus a `useWikiCardActions` hook that reads the main-view tab from the router and both active screens from player state, and returns ready-to-render menu items. **Push to Tabletop** reuses the existing `openTabletopWindow` path (shared, broadcast, GM-only) that drag-drop already calls. **Show on Tab** is new: a `privateWindows` array on `TabletopPlayerState`, written only by its owner, merged into each surface at render time.

**Tech Stack:** React 19, TanStack Start (server functions) + TanStack Router + React Query, Mongoose/MongoDB, Zod, Vitest (happy-dom, globals on), Testing Library, Playwright.

**Spec:** `docs/specs/2026-07-17-wiki-card-overflow-menu-design.md`

## Global Constraints

- `npm run typecheck` and `npm run lint` must both be clean. **`lint` runs with `--max-warnings 0`** — any new warning fails CI.
- `npm test` runs `vitest run --project unit`. **Never run bare `npx vitest run`** — the storybook project crashes outside CI.
- Path alias is `~/` → `app/`. Unit tests live under `tests/` mirroring `app/`.
- Unit tests **mock mongoose** — there is no in-memory Mongo. Use per-method model mocks.
- Server functions: Zod schema → server fn → hook → query key. Hooks reach server code via `await import()` so Mongoose stays server-only.
- Every server fn catch block calls `serverCaptureException`. Client mutations call `captureException`. Never `await` capture calls.
- **Push (`openTabletopWindow`) stays `requireCampaignGM` — do not relax it.** The new private-window fns are `requireCampaignMember` and must write only to the caller's own document.
- Commit after each task. Branch targets `dev`, never `main`.

---

## File Structure

**Create:**

| Path                                            | Responsibility                                               |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `app/components/shared/OverflowMenu.tsx`        | Presentational menu primitive. Knows nothing about the wiki. |
| `app/components/wiki/shared/WikiCardMenu.tsx`   | Glue: calls the hook, renders the primitive.                 |
| `app/hooks/useWikiCardActions.ts`               | All action/permission/target branching.                      |
| `tests/components/shared/OverflowMenu.test.tsx` | Primitive behaviour + a11y.                                  |
| `tests/hooks/useWikiCardActions.test.tsx`       | The permission matrix.                                       |
| `tests/server/functions/privateWindows.test.ts` | Server fn guards + cap.                                      |
| `e2e/wiki/card-overflow-menu.spec.ts`           | Two-browser shared-vs-private proof.                         |

**Modify:**

| Path                                                  | Change                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `app/types/schemas/tabletop.ts`                       | `TABLETOP_COLLECTIONS` += `spell`; private-window schemas; `activeGMScreenId`. |
| `app/types/schemas/gmscreens.ts`                      | `SUPPORTED_COLLECTIONS` += `spell`.                                            |
| `app/types/tabletop.ts`                               | `PrivateWindowData`; `TabletopPlayerStateData` fields.                         |
| `app/server/db/models/TabletopPlayerState.ts`         | `privateWindows`, `activeGMScreenId`.                                          |
| `app/server/functions/tabletop.ts`                    | Serializer; `addPrivateWindow`; `removePrivateWindow`.                         |
| `app/server/functions/tabletop-hydration.ts`          | `COLLECTION_REGISTRY` += `spell`.                                              |
| `app/server/functions/gmscreens.ts`                   | Second `COLLECTION_REGISTRY` += `spell`.                                       |
| `app/hooks/useTabletopPlayerState.ts`                 | Private-window mutations; `activeGMScreenId`.                                  |
| `app/components/mainview/tabletop/TabletopView.tsx`   | `spell` branch; private-window merge.                                          |
| `app/components/mainview/gmscreens/GMScreensView.tsx` | `spell` branch; merge; active screen from player state.                        |
| `app/components/wiki/maps/MapCard.tsx`                | Adopt `OverflowMenu`.                                                          |
| `app/components/wiki/shared/ShowOnTabletopButton.tsx` | Refactor onto the hook.                                                        |
| 11 wiki card components                               | Add `<WikiCardMenu>`.                                                          |
| `tests/types/schemas/lore-window-collection.test.ts`  | `spell` guard.                                                                 |
| `docs/tabletop/README.md`, `architecture.md`          | Document the two actions.                                                      |

---

### Task 1: OverflowMenu primitive

**Files:**

- Create: `app/components/shared/OverflowMenu.tsx`
- Test: `tests/components/shared/OverflowMenu.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: `OverflowMenu` component; `MenuItem` type:
  ```ts
  export interface MenuItem {
    key: string;
    label: string;
    icon?: ReactNode;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
  }
  ```

**Why:** `MapCard`'s menu is hand-rolled with no Escape handler, no focus restore, no roving focus, no `aria-expanded`, and zero tests. Generalizing it to 12 cards means building it properly once.

- [ ] **Step 1: Write the failing test**

Create `tests/components/shared/OverflowMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverflowMenu } from '~/components/shared/OverflowMenu';

const items = [
  { key: 'edit', label: 'Edit', onSelect: vi.fn() },
  { key: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
];

describe('OverflowMenu', () => {
  it('is closed initially and reports collapsed state', () => {
    render(<OverflowMenu items={items} label="Item actions" />);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on trigger click and lists every item', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={items} label="Item actions" />);
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('calls onSelect and closes when an item is chosen', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <OverflowMenu items={[{ key: 'edit', label: 'Edit', onSelect }]} label="Item actions" />
    );
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={items} label="Item actions" />);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('moves focus between items with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={items} label="Item actions" />);
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('does not fire onSelect for a disabled item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <OverflowMenu
        items={[{ key: 'push', label: 'Push', onSelect, disabled: true }]}
        label="Item actions"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Push' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<OverflowMenu items={[]} label="Item actions" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/shared/OverflowMenu.test.tsx`
Expected: FAIL — cannot resolve `~/components/shared/OverflowMenu`.

- [ ] **Step 3: Write the implementation**

Create `app/components/shared/OverflowMenu.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';

export interface MenuItem {
  /** Stable identity for React keys and tests. */
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip — used to explain why a disabled item is disabled. */
  title?: string;
}

interface OverflowMenuProps {
  items: MenuItem[];
  /** aria-label for the trigger, e.g. "Character actions". */
  label: string;
}

/**
 * Presentational overflow (⋮) menu. Knows nothing about the wiki or campaigns —
 * callers pass fully-resolved items.
 *
 * Owns the keyboard/focus contract the hand-rolled MapCard menu never had:
 * Escape closes, focus returns to the trigger, and Arrow keys rove.
 */
export function OverflowMenu({ items, label }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Escape closes from anywhere within the menu and returns focus to the trigger,
  // so keyboard users are never stranded inside a closed popup.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (items.length === 0) return null;

  const focusItemAt = (index: number) => {
    const count = items.length;
    const next = ((index % count) + count) % count;
    itemRefs.current[next]?.focus();
  };

  const currentIndex = () => itemRefs.current.findIndex((el) => el === document.activeElement);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItemAt(currentIndex() + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = currentIndex();
      focusItemAt(i === -1 ? items.length - 1 : i - 1);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.03] text-slate-400 opacity-0 transition-opacity hover:bg-white/[0.07] hover:text-slate-200 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          {/* Click-catcher: closes without stealing focus back to the trigger. */}
          <div className="fixed inset-0 z-10" onClick={() => close(false)} aria-hidden />
          <div
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded border border-white/[0.07] bg-[#080A12] shadow-lg"
          >
            {items.map((item, i) => (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                data-testid={`overflow-item-${item.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled) return;
                  close(false);
                  item.onSelect();
                }}
                className={[
                  'flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-xs transition-colors hover:bg-white/[0.05]',
                  item.danger ? 'text-rose-300 hover:text-rose-200' : 'text-slate-300',
                  item.disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : '',
                ].join(' ')}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/components/shared/OverflowMenu.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Gates**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add app/components/shared/OverflowMenu.tsx tests/components/shared/OverflowMenu.test.tsx
git commit -m "feat(ui): add a shared OverflowMenu primitive with a real keyboard contract"
```

---

### Task 2: MapCard adopts OverflowMenu

**Files:**

- Modify: `app/components/wiki/maps/MapCard.tsx` (replace the inline menu + local `MenuItem`)

**Interfaces:**

- Consumes: `OverflowMenu`, `MenuItem` from Task 1.
- Produces: nothing new. `MapCardProps` is unchanged.

**Why:** Proves the primitive against the only existing menu before 11 more cards depend on it. `MapCard` keeps Set Active / Edit / Delete and gains **no** push action (a map is the surface, not a document window — spec decision 8).

- [ ] **Step 1: Replace the menu block**

In `app/components/wiki/maps/MapCard.tsx`, change the imports:

```tsx
import { MapPin, Eye, Trash2, Edit2 } from 'lucide-react';
import { OverflowMenu, type MenuItem } from '~/components/shared/OverflowMenu';
import type { MapListItem } from '~/types/map';
```

`useState`, `type ReactNode`, and `MoreVertical` are no longer used — remove them or lint will fail on `--max-warnings 0`.

Delete the `const [menuOpen, setMenuOpen] = useState(false);` line, the whole `{isGM && (<div className="absolute right-2 top-2">…</div>)}` block, and the local `MenuItem` function at the bottom of the file. Replace the block with:

```tsx
{
  isGM && (
    <div className="absolute right-2 top-2">
      <OverflowMenu label="Map actions" items={mapMenuItems} />
    </div>
  );
}
```

And build the items above the `return`, inside the component:

```tsx
const mapMenuItems: MenuItem[] = [
  {
    key: 'set-active',
    label: isActive ? 'Clear Active' : 'Set Active',
    icon: <Eye className="h-3.5 w-3.5" />,
    onSelect: () => onSetActive(map),
  },
  {
    key: 'edit',
    label: 'Edit',
    icon: <Edit2 className="h-3.5 w-3.5" />,
    onSelect: () => onEdit(map),
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: <Trash2 className="h-3.5 w-3.5" />,
    danger: true,
    onSelect: () => onDelete(map),
  },
];
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npm test`
Expected: 1685 passed (no MapCard tests exist — this is a no-regression check).

- [ ] **Step 3: Gates**

Run: `npm run typecheck && npm run lint`
Expected: both clean. If lint reports an unused import, delete it.

- [ ] **Step 4: Commit**

```bash
git add app/components/wiki/maps/MapCard.tsx
git commit -m "refactor(wiki): move MapCard onto the shared OverflowMenu"
```

---

### Task 3: Make `spell` a supported window collection

**Files:**

- Modify: `app/types/schemas/tabletop.ts` (`TABLETOP_COLLECTIONS`)
- Modify: `app/types/schemas/gmscreens.ts` (`SUPPORTED_COLLECTIONS`)
- Modify: `app/server/functions/tabletop-hydration.ts` (`COLLECTION_REGISTRY`)
- Modify: `app/server/functions/gmscreens.ts` (the second `COLLECTION_REGISTRY`)
- Modify: `app/components/mainview/tabletop/TabletopView.tsx` (render branch)
- Modify: `app/components/mainview/gmscreens/GMScreensView.tsx` (render branch)
- Test: `tests/types/schemas/lore-window-collection.test.ts` (extend)

**Interfaces:**

- Consumes: nothing.
- Produces: `'spell'` accepted by `openTabletopWindowSchema` and `openWindowSchema`; `SpellWindow` rendered on both surfaces.

**Why:** Spell cards already set `collection: 'spell'` in their drag payload, but `spell` is in **none** of the allowlists, so the server silently rejects it. Six places must change; nothing enforces the sync. `app/components/wiki/spells/SpellWindow.tsx` already exists — no new component needed.

- [ ] **Step 1: Write the failing test**

Append to `tests/types/schemas/lore-window-collection.test.ts`:

```ts
/**
 * Regression guard: `'spell'` must be an accepted window collection. SpellCard
 * has always set `collection: 'spell'` in its drag payload, but the value was
 * missing from both allowlists, so every spell drop was rejected server-side.
 */
describe('spell is an accepted tabletop/GM-screen window collection', () => {
  it('openTabletopWindowSchema accepts collection "spell"', () => {
    const result = openTabletopWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'spell',
      documentId: 'sp1',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('gmscreens openWindowSchema accepts collection "spell"', () => {
    const result = openWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'spell',
      documentId: 'sp1',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit tests/types/schemas/lore-window-collection.test.ts`
Expected: FAIL — both new cases report `success: false` (invalid enum value).

- [ ] **Step 3: Add `spell` to both allowlists**

In `app/types/schemas/tabletop.ts`, add `'spell',` to `TABLETOP_COLLECTIONS` (after `'quest',`).
In `app/types/schemas/gmscreens.ts`, add `'spell',` to `SUPPORTED_COLLECTIONS` (after `'quest',`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit tests/types/schemas/lore-window-collection.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the hydration fetchers**

The schema now accepts `spell`, but a window would render with a fallback title because neither registry can fetch it. In **both** `app/server/functions/tabletop-hydration.ts` and `app/server/functions/gmscreens.ts`, add a `spell` entry to `COLLECTION_REGISTRY` modelled exactly on the neighbouring `rule` entry in that same file — same import style (`await import('~/server/db/models/Spell')`), same projection shape, same `title` field mapping. Read the `rule` entry first and mirror it; do not invent a different shape.

- [ ] **Step 6: Add the render branches**

In `app/components/mainview/tabletop/TabletopView.tsx` and `app/components/mainview/gmscreens/GMScreensView.tsx`, import `SpellWindow` from `~/components/wiki/spells/SpellWindow` and add a `w.collection === 'spell'` branch to the window-render chain, mirroring the adjacent `rule` branch's props in each file.

- [ ] **Step 7: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean; 1685+ passing.

- [ ] **Step 8: Commit**

```bash
git add app/types/schemas/tabletop.ts app/types/schemas/gmscreens.ts \
  app/server/functions/tabletop-hydration.ts app/server/functions/gmscreens.ts \
  app/components/mainview/tabletop/TabletopView.tsx \
  app/components/mainview/gmscreens/GMScreensView.tsx \
  tests/types/schemas/lore-window-collection.test.ts
git commit -m "feat(wiki): make spell a supported window collection"
```

---

### Task 4: Data model — `privateWindows` and `activeGMScreenId`

**Files:**

- Modify: `app/server/db/models/TabletopPlayerState.ts`
- Modify: `app/types/tabletop.ts`
- Modify: `app/types/schemas/tabletop.ts`
- Modify: `app/server/functions/tabletop.ts` (`serializePlayerState`, `getPlayerState` doc type)

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  export interface PrivateWindowData {
    id: string;
    surface: 'tabletop' | 'gmscreen';
    screenId: string;
    collection: string;
    documentId: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    zIndex: number;
    state: 'open' | 'minimized' | 'hidden';
  }
  ```
  `TabletopPlayerStateData` gains `activeGMScreenId: string | null` and `privateWindows: PrivateWindowData[]`.
  New schemas: `addPrivateWindowSchema`, `removePrivateWindowSchema`. `updatePlayerStateSchema` gains `activeGMScreenId`.

**Why:** `activeGMScreenId` is not optional polish — `GMScreensView` keeps its active screen in local `useState` and never persists it, so the wiki (a sibling subtree) cannot read it, and "Show on Tab" on GM Screens is unimplementable without this.

- [ ] **Step 1: Extend the Mongoose model**

In `app/server/db/models/TabletopPlayerState.ts`, add a sub-schema above `tabletopPlayerStateSchema`:

```ts
const privateWindowSchema = new mongoose.Schema(
  {
    surface: { type: String, enum: ['tabletop', 'gmscreen'], required: true },
    screenId: { type: mongoose.Schema.Types.ObjectId, required: true },
    collection: { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    zIndex: { type: Number, default: 0 },
    state: { type: String, enum: ['open', 'minimized', 'hidden'], default: 'open' },
  },
  { _id: true }
);
```

Then add both fields to `tabletopPlayerStateSchema`, after `windowOverrides`:

```ts
    /**
     * The caller's active GM screen. Mirrors activeScreenId, which covers the
     * Tabletop only. Lives here (rather than on a GM-screens model) because
     * GMScreen is campaign-scoped and shared between co-GMs, while this is
     * per-user — despite the model's tabletop-flavoured name.
     */
    activeGMScreenId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /**
     * Windows only this user can see, across BOTH surfaces (see `surface`).
     * Distinct from TabletopScreen.windows[], which is shared and broadcast.
     */
    privateWindows: { type: [privateWindowSchema], default: [] },
```

- [ ] **Step 2: Extend the client types**

In `app/types/tabletop.ts`, add:

```ts
export interface PrivateWindowData {
  id: string;
  surface: 'tabletop' | 'gmscreen';
  screenId: string;
  collection: string;
  documentId: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  zIndex: number;
  state: 'open' | 'minimized' | 'hidden';
}
```

and extend the existing interface:

```ts
export interface TabletopPlayerStateData {
  id: string;
  campaignId: string;
  userId: string;
  activeScreenId: string | null;
  activeGMScreenId: string | null;
  viewports: ViewportData[];
  windowOverrides: WindowOverrideData[];
  privateWindows: PrivateWindowData[];
}
```

- [ ] **Step 3: Extend the serializer**

In `app/server/functions/tabletop.ts`, widen the `serializePlayerState` doc parameter with:

```ts
  activeGMScreenId?: unknown;
  privateWindows?: Array<{
    _id?: unknown;
    surface?: string;
    screenId?: unknown;
    collection?: string;
    documentId?: unknown;
    x?: number;
    y?: number;
    width?: number | null;
    height?: number | null;
    zIndex?: number;
    state?: string;
  }>;
```

and add to its return object:

```ts
    activeGMScreenId: doc.activeGMScreenId ? String(doc.activeGMScreenId) : null,
    privateWindows: (doc.privateWindows ?? []).map(
      (pw): PrivateWindowData => ({
        id: String(pw._id),
        surface: pw.surface === 'gmscreen' ? 'gmscreen' : 'tabletop',
        screenId: String(pw.screenId),
        collection: pw.collection ?? '',
        documentId: String(pw.documentId),
        x: pw.x ?? 0,
        y: pw.y ?? 0,
        width: pw.width ?? null,
        height: pw.height ?? null,
        zIndex: pw.zIndex ?? 0,
        state: WINDOW_STATES.includes(pw.state as WS) ? (pw.state as WS) : 'open',
      })
    ),
```

Import `PrivateWindowData` alongside the existing type imports. Apply the same two field additions to the inline `doc` cast inside `getPlayerState`, or its `lean()` result will not type-check.

- [ ] **Step 4: Add the Zod schemas**

In `app/types/schemas/tabletop.ts`, add `activeGMScreenId: z.string().nullable().optional(),` to `updatePlayerStateSchema` (directly after `activeScreenId`), and add:

```ts
export const addPrivateWindowSchema = z.object({
  campaignId: z.string().trim().min(1),
  surface: z.enum(['tabletop', 'gmscreen']),
  screenId: z.string().trim().min(1),
  collection: z.enum(TABLETOP_COLLECTIONS),
  documentId: z.string().trim().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const removePrivateWindowSchema = z.object({
  campaignId: z.string().trim().min(1),
  privateWindowId: z.string().trim().min(1),
});
```

`TABLETOP_COLLECTIONS` is declared in this file — reuse it rather than redeclaring, so private windows can never drift from the shared allowlist.

- [ ] **Step 5: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean, 1685+ passing. Existing player-state tests must still pass — the new fields default to `null`/`[]`.

- [ ] **Step 6: Commit**

```bash
git add app/server/db/models/TabletopPlayerState.ts app/types/tabletop.ts \
  app/types/schemas/tabletop.ts app/server/functions/tabletop.ts
git commit -m "feat(tabletop): add privateWindows + activeGMScreenId to player state"
```

---

### Task 5: Server functions — add/remove private window

**Files:**

- Modify: `app/server/functions/tabletop.ts`
- Test: `tests/server/functions/privateWindows.test.ts`

**Interfaces:**

- Consumes: `addPrivateWindowSchema`, `removePrivateWindowSchema` (Task 4); the file-local `requireCampaignMember`.
- Produces:
  ```ts
  export const addPrivateWindow: (args: {
    data: z.infer<typeof addPrivateWindowSchema>;
  }) => Promise<TabletopPlayerStateData>;
  export const removePrivateWindow: (args: {
    data: z.infer<typeof removePrivateWindowSchema>;
  }) => Promise<TabletopPlayerStateData>;
  export const MAX_PRIVATE_WINDOWS = 20;
  ```

**Why:** These are the only member-writable window operations. They must be **`requireCampaignMember`** (not GM) and must match on the authenticated `userId` so a caller can never touch another user's document.

- [ ] **Step 1: Write the failing test**

Create `tests/server/functions/privateWindows.test.ts`. Follow the existing mongoose-mocking style in `tests/server/functions/tabletop.test.ts` — read it first and mirror its `vi.mock` setup for `~/server/db/models/TabletopPlayerState`, `~/server/db/connection`, and the session/campaign lookups.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the mock scaffolding from tests/server/functions/tabletop.test.ts.
// The assertions below are what matter:

describe('addPrivateWindow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a non-GM member', async () => {
    // Arrange: session user is a plain member (role: 'player') of the campaign.
    // Act: addPrivateWindow({ data: { campaignId, surface: 'tabletop', screenId, collection: 'character', documentId } })
    // Assert: resolves (does NOT throw Forbidden)
  });

  it('writes only to the calling user’s own document', async () => {
    // Assert: the updateOne filter includes BOTH campaignId AND the authenticated userId.
    // This is the guard that stops a member editing someone else's private windows.
  });

  it('rejects past MAX_PRIVATE_WINDOWS for that surface+screen', async () => {
    // Arrange: existing doc already has 20 privateWindows for this surface+screen.
    // Act + Assert: rejects with an error mentioning the limit; no write is issued.
  });

  it('does not broadcast', async () => {
    // Assert: no realtime/broadcast helper is called — private windows are never relayed.
  });
});

describe('removePrivateWindow', () => {
  it('pulls only the matching id from the caller’s own document', async () => {
    // Assert: $pull filter is scoped by campaignId + authenticated userId + privateWindowId.
  });
});
```

Replace each comment block with real arrange/act/assert once the mock scaffolding is copied — the assertions listed are the contract; do not skip the ownership-filter or cap cases.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit tests/server/functions/privateWindows.test.ts`
Expected: FAIL — `addPrivateWindow` is not exported.

- [ ] **Step 3: Implement**

In `app/server/functions/tabletop.ts`, after `updatePlayerState`:

```ts
// ---------------------------------------------------------------------------
// Private windows — the caller's own, never shared, never broadcast
// ---------------------------------------------------------------------------

export { addPrivateWindowSchema, removePrivateWindowSchema };

/** Per surface+screen. Mirrors GMSCREEN_LIMITS.MAX_WINDOWS. */
export const MAX_PRIVATE_WINDOWS = 20;

export const addPrivateWindow = async ({
  data,
}: {
  data: z.infer<typeof addPrivateWindowSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    // Member, not GM: this writes only to the caller's own player-state document
    // and cannot affect what anyone else sees.
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const existing = await TabletopPlayerState.findOne({
      campaignId: data.campaignId,
      userId: member.userId,
    }).lean();

    const current = (existing?.privateWindows ?? []) as Array<{
      surface?: string;
      screenId?: unknown;
    }>;
    const onThisScreen = current.filter(
      (pw) => pw.surface === data.surface && String(pw.screenId) === data.screenId
    );
    if (onThisScreen.length >= MAX_PRIVATE_WINDOWS) {
      throw new Error(`Private window limit reached (${MAX_PRIVATE_WINDOWS} per screen)`);
    }

    await TabletopPlayerState.updateOne(
      { campaignId: data.campaignId, userId: member.userId },
      {
        $push: {
          privateWindows: {
            surface: data.surface,
            screenId: data.screenId,
            collection: data.collection,
            documentId: data.documentId,
            x: data.x ?? 0,
            y: data.y ?? 0,
            zIndex: 0,
            state: 'open',
          },
        },
        $setOnInsert: { campaignId: data.campaignId, userId: member.userId },
      },
      { upsert: true }
    );

    const doc = await TabletopPlayerState.findOne({
      campaignId: data.campaignId,
      userId: member.userId,
    }).lean();
    return serializePlayerState(doc as Parameters<typeof serializePlayerState>[0]);
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'addPrivateWindow',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

export const removePrivateWindow = async ({
  data,
}: {
  data: z.infer<typeof removePrivateWindowSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    await TabletopPlayerState.updateOne(
      { campaignId: data.campaignId, userId: member.userId },
      { $pull: { privateWindows: { _id: data.privateWindowId } } }
    );

    const doc = await TabletopPlayerState.findOne({
      campaignId: data.campaignId,
      userId: member.userId,
    }).lean();
    return serializePlayerState(doc as Parameters<typeof serializePlayerState>[0]);
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'removePrivateWindow',
      campaignId: data.campaignId,
    });
    throw e;
  }
};
```

Add `addPrivateWindowSchema` / `removePrivateWindowSchema` to the file's existing schema import from `~/types/schemas/tabletop`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/server/functions/privateWindows.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add app/server/functions/tabletop.ts tests/server/functions/privateWindows.test.ts
git commit -m "feat(tabletop): add member-scoped private window server functions"
```

---

### Task 6: Client hook — private windows and `activeGMScreenId`

**Files:**

- Modify: `app/hooks/useTabletopPlayerState.ts`

**Interfaces:**

- Consumes: Task 4 schemas; Task 5 server fns.
- Produces: `useTabletopPlayerState(campaignId)` additionally returns

  ```ts
  addPrivateWindow: UseMutationResult<..., {
    surface: 'tabletop' | 'gmscreen';
    screenId: string;
    collection: string;
    documentId: string;
    x?: number;
    y?: number;
  }>;
  removePrivateWindow: UseMutationResult<..., { privateWindowId: string }>;
  ```

  and `updateState` accepts `activeGMScreenId?: string | null`.

- [ ] **Step 1: Add the server-fn wrappers**

In `app/hooks/useTabletopPlayerState.ts`, after `updateStateFn`:

```ts
const addPrivateWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(addPrivateWindowSchema)
  .handler(async ({ data }) => {
    const { addPrivateWindow } = await import('~/server/functions/tabletop');
    return addPrivateWindow({ data });
  });

const removePrivateWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(removePrivateWindowSchema)
  .handler(async ({ data }) => {
    const { removePrivateWindow } = await import('~/server/functions/tabletop');
    return removePrivateWindow({ data });
  });
```

Extend the schema import:

```ts
import {
  getPlayerStateSchema,
  updatePlayerStateSchema,
  addPrivateWindowSchema,
  removePrivateWindowSchema,
} from '~/types/schemas/tabletop';
```

- [ ] **Step 2: Add the mutations and widen `updateState`**

Add `activeGMScreenId?: string | null;` to the `updateStateMutation` params type, directly after `activeScreenId`. Then add:

```ts
const addPrivateWindowMutation = useMutation({
  mutationFn: (params: {
    surface: 'tabletop' | 'gmscreen';
    screenId: string;
    collection: string;
    documentId: string;
    x?: number;
    y?: number;
  }) => addPrivateWindowFn({ data: { campaignId, ...params } }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.playerState(campaignId) });
  },
  onError: (e) => {
    captureException(e, { action: 'addPrivateWindow' });
  },
});

const removePrivateWindowMutation = useMutation({
  mutationFn: (params: { privateWindowId: string }) =>
    removePrivateWindowFn({ data: { campaignId, ...params } }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.playerState(campaignId) });
  },
  onError: (e) => {
    captureException(e, { action: 'removePrivateWindow' });
  },
});
```

and extend the return:

```ts
return {
  playerState,
  isLoading,
  updateState: updateStateMutation,
  addPrivateWindow: addPrivateWindowMutation,
  removePrivateWindow: removePrivateWindowMutation,
};
```

- [ ] **Step 3: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add app/hooks/useTabletopPlayerState.ts
git commit -m "feat(tabletop): expose private window mutations from the player-state hook"
```

---

### Task 7: GMScreensView reads its active screen from player state

**Files:**

- Modify: `app/components/mainview/gmscreens/GMScreensView.tsx`

**Interfaces:**

- Consumes: `useTabletopPlayerState` (Task 6).
- Produces: `playerState.activeGMScreenId` is kept current whenever the GM changes GM-screen tabs.

**Why:** This is the enabling change for "Show on Tab" on GM Screens — the wiki cannot read component-local state. It is also the riskiest task: `activeScreenId` has 52 references in this file.

**Caution:** Keep the local `useState` as the render source of truth and _sync_ it to player state. Do not rip out local state and drive the UI straight from the query, or every tab click will wait on a round-trip.

- [ ] **Step 1: Seed local state from player state**

Add near the top of the component, after the existing `useState`:

```tsx
const { playerState, updateState } = useTabletopPlayerState(campaignId);
```

Then seed once, when player state first arrives and nothing is selected yet:

```tsx
// Restore the GM's last screen. Falls back to the first screen on first visit
// (activeGMScreenId is null until they pick one).
useEffect(() => {
  if (activeScreenId) return;
  if (!screens.length) return;
  const restored = playerState?.activeGMScreenId;
  const exists = restored && screens.some((s) => s.id === restored);
  setActiveScreenId(exists ? restored : screens[0].id);
}, [activeScreenId, screens, playerState?.activeGMScreenId]);
```

- [ ] **Step 2: Persist on change**

Find the handler that sets the active screen when a GM clicks a screen tab (search for `setActiveScreenId` calls in the tab-change path) and persist alongside it:

```tsx
const handleScreenChange = useCallback(
  (id: string) => {
    setActiveScreenId(id);
    updateState.mutate({ activeGMScreenId: id });
  },
  [updateState]
);
```

Route the tab-bar's change callback through `handleScreenChange`. Do **not** persist from the seeding effect in Step 1 — that would write on every mount.

- [ ] **Step 3: Verify no regression**

Run: `npm test`
Expected: all passing. Then run the GM-screens e2e, which is the real guard here:

Run: `npx playwright test e2e/gmscreens/ --reporter=list`
Expected: all passing. (Requires a seeded dev DB and a dev server; see `e2e/globalSetup.ts`.)

- [ ] **Step 4: Gates**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/gmscreens/GMScreensView.tsx
git commit -m "feat(gmscreens): persist the GM's active screen to player state"
```

---

### Task 8: `useWikiCardActions`

**Files:**

- Create: `app/hooks/useWikiCardActions.ts`
- Test: `tests/hooks/useWikiCardActions.test.tsx`

**Interfaces:**

- Consumes: `MenuItem` (Task 1); `useTabletopPlayerState` (Task 6); `useTabletopScreenList`, `useTabletopMutations` (existing); `useCampaign` (existing).
- Produces:
  ```ts
  export function useWikiCardActions(params: {
    collection: string;
    documentId: string;
    canEdit?: boolean;
    onEdit?: () => void;
    onDelete?: () => void;
  }): { menuItems: MenuItem[] };
  ```

**Why:** This is the whole permission matrix in one testable place, instead of spread across 12 cards.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useWikiCardActions.test.tsx`. Mock the four hooks it depends on; assert on the returned item keys.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWikiCardActions } from '~/hooks/useWikiCardActions';

const mockSearch = vi.fn();
const mockCampaign = vi.fn();
const mockPlayerState = vi.fn();
// Hoisted so individual tests can assert on what the push action dispatched.
const openWindowMutate = vi.fn();
const addPrivateWindowMutate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'c1' }),
  useSearch: () => mockSearch(),
}));
vi.mock('~/hooks/useCampaigns', () => ({ useCampaign: () => mockCampaign() }));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => mockPlayerState(),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  // screens[0] is deliberately NOT the active screen, so a test that expects
  // 'active' fails loudly if the old screens[0] targeting ever comes back.
  useTabletopScreenList: () => ({ screens: [{ id: 'first' }, { id: 'active' }] }),
  useTabletopMutations: () => ({ openWindow: { mutate: openWindowMutate, isPending: false } }),
}));

const keys = (items: { key: string }[]) => items.map((i) => i.key);

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch.mockReturnValue({ tab: 'tabletop' });
  mockCampaign.mockReturnValue({ campaign: { isGM: true } });
  mockPlayerState.mockReturnValue({
    playerState: { activeScreenId: 'active', activeGMScreenId: 'gm1', privateWindows: [] },
    addPrivateWindow: { mutate: addPrivateWindowMutate },
    removePrivateWindow: { mutate: vi.fn() },
  });
});

describe('useWikiCardActions', () => {
  it('gives a GM on the Tabletop all four actions', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        canEdit: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['edit', 'show-on-tab', 'push', 'delete']);
  });

  it('gives a player Show on Tab and Edit only when canEdit', () => {
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        canEdit: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['edit', 'show-on-tab']);
  });

  it('never gives a player push or delete, even without canEdit', () => {
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1', canEdit: false })
    );
    expect(keys(result.current.menuItems)).toEqual(['show-on-tab']);
  });

  it('hides both display actions on the Dashboard', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        canEdit: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['edit', 'delete']);
  });

  it('still offers Push to Tabletop from the GM Screens tab', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    expect(keys(result.current.menuItems)).toContain('push');
  });

  it('targets the ACTIVE screen, not screens[0]', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
    expect(openWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'active', collection: 'character', documentId: 'd1' })
    );
  });

  it('Show on Tab writes a private window for the current surface', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).toHaveBeenCalledWith({
      surface: 'tabletop',
      screenId: 'active',
      collection: 'character',
      documentId: 'd1',
    });
  });

  it('Show on Tab targets the GM screen when on the GM Screens tab', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'gmscreen', screenId: 'gm1' })
    );
  });

  it('does not add a duplicate private window when one already exists', () => {
    mockPlayerState.mockReturnValue({
      playerState: {
        activeScreenId: 'active',
        activeGMScreenId: 'gm1',
        privateWindows: [
          {
            id: 'pw1',
            surface: 'tabletop',
            screenId: 'active',
            collection: 'character',
            documentId: 'd1',
          },
        ],
      },
      addPrivateWindow: { mutate: addPrivateWindowMutate },
      removePrivateWindow: { mutate: vi.fn() },
    });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).not.toHaveBeenCalled();
  });

  it('returns no items when nothing qualifies', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1', canEdit: false })
    );
    expect(result.current.menuItems).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit tests/hooks/useWikiCardActions.test.tsx`
Expected: FAIL — cannot resolve `~/hooks/useWikiCardActions`.

- [ ] **Step 3: Implement**

Create `app/hooks/useWikiCardActions.ts`:

```ts
import { useParams, useSearch } from '@tanstack/react-router';
import { Edit2, Monitor, Trash2, Radio } from 'lucide-react';
import { createElement } from 'react';
import type { MenuItem } from '~/components/shared/OverflowMenu';
import { useCampaign } from '~/hooks/useCampaigns';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import { useTabletopScreenList, useTabletopMutations } from '~/hooks/useTabletopScreens';

interface UseWikiCardActionsParams {
  collection: string;
  documentId: string;
  /** Per-item edit right from the list DTO. Absent means "not editable here". */
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * Builds the overflow-menu items for a wiki card.
 *
 * Two distinct display actions:
 *  - "Show on Tab"      — private to the caller, any member, current tab.
 *  - "Push to Tabletop" — shared with everyone, GM only, ALWAYS the tabletop.
 *
 * Reads the main-view tab from the router rather than taking it as a prop: the
 * prop chain from play.tsx dead-ends at MainView, and the panels already reach
 * for the router directly (see WikiPanel/MapsPanel).
 */
export function useWikiCardActions({
  collection,
  documentId,
  canEdit,
  onEdit,
  onDelete,
}: UseWikiCardActionsParams): { menuItems: MenuItem[] } {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { tab } = useSearch({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { screens } = useTabletopScreenList(campaignId);
  const tabletopMutations = useTabletopMutations(campaignId);
  const { playerState, addPrivateWindow } = useTabletopPlayerState(campaignId);

  const items: MenuItem[] = [];

  if (canEdit && onEdit) {
    items.push({
      key: 'edit',
      label: 'Edit',
      icon: createElement(Edit2, { className: 'h-3.5 w-3.5' }),
      onSelect: onEdit,
    });
  }

  // Which surface is the user looking at? Dashboard has no surface, so both
  // display actions are hidden there.
  const surface = tab === 'tabletop' ? 'tabletop' : tab === 'gmscreens' ? 'gmscreen' : null;

  if (surface) {
    const screenId =
      surface === 'tabletop' ? playerState?.activeScreenId : playerState?.activeGMScreenId;

    const alreadyPrivate = (playerState?.privateWindows ?? []).some(
      (pw) =>
        pw.surface === surface &&
        pw.screenId === screenId &&
        pw.collection === collection &&
        pw.documentId === documentId
    );

    items.push({
      key: 'show-on-tab',
      label: 'Show on Tab',
      icon: createElement(Monitor, { className: 'h-3.5 w-3.5' }),
      disabled: !screenId,
      title: screenId ? 'Show here — only you will see it' : 'No screen available',
      onSelect: () => {
        if (!screenId) return;
        // Already open: the surface focuses + flashes it; nothing to add.
        if (alreadyPrivate) {
          focusExistingWindow(surface, collection, documentId);
          return;
        }
        addPrivateWindow.mutate({ surface, screenId, collection, documentId });
      },
    });
  }

  // Push is GM-only and ALWAYS targets the tabletop, even from GM Screens.
  if (isGM && surface) {
    const tabletopScreenId = playerState?.activeScreenId ?? screens[0]?.id ?? null;
    items.push({
      key: 'push',
      label: 'Push to Tabletop',
      icon: createElement(Radio, { className: 'h-3.5 w-3.5' }),
      disabled: !tabletopScreenId,
      title: tabletopScreenId
        ? 'Show on the tabletop for everyone'
        : 'No tabletop screen available',
      onSelect: () => {
        if (!tabletopScreenId) return;
        tabletopMutations.openWindow.mutate({
          screenId: tabletopScreenId,
          collection,
          documentId,
        });
      },
    });
  }

  if (isGM && onDelete) {
    items.push({
      key: 'delete',
      label: 'Delete',
      icon: createElement(Trash2, { className: 'h-3.5 w-3.5' }),
      danger: true,
      onSelect: onDelete,
    });
  }

  return { menuItems: items };
}

/**
 * Ask the active surface to bring an already-open window forward. Implemented
 * as a window event so the wiki (Inspector subtree) can reach TabletopView /
 * GMScreensView without shared state — the same bridge pattern the dice roller
 * uses (see app/utils/diceRollerBridge.ts).
 */
function focusExistingWindow(surface: string, collection: string, documentId: string) {
  window.dispatchEvent(
    new CustomEvent('cartyx:focus-window', { detail: { surface, collection, documentId } })
  );
}
```

**Note on `screens[0]` in the push branch:** this is a _fallback_ only when player state has no active screen yet (first visit). The primary target is `activeScreenId`, which is the bug fix. Do not reorder these.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/hooks/useWikiCardActions.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Gates**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useWikiCardActions.ts tests/hooks/useWikiCardActions.test.tsx
git commit -m "feat(wiki): add useWikiCardActions with the card action matrix"
```

---

### Task 9: `WikiCardMenu` glue

**Files:**

- Create: `app/components/wiki/shared/WikiCardMenu.tsx`

**Interfaces:**

- Consumes: `useWikiCardActions` (Task 8), `OverflowMenu` (Task 1).
- Produces:

  ```tsx
  <WikiCardMenu
    collection="character"
    documentId={c.id}
    label="Character actions"
    canEdit={c.canEdit}
    onEdit={() => …}
    onDelete={() => …}
  />
  ```

- [ ] **Step 1: Implement**

Create `app/components/wiki/shared/WikiCardMenu.tsx`:

```tsx
import { OverflowMenu } from '~/components/shared/OverflowMenu';
import { useWikiCardActions } from '~/hooks/useWikiCardActions';

interface WikiCardMenuProps {
  collection: string;
  documentId: string;
  /** aria-label for the trigger, e.g. "Character actions". */
  label: string;
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * The overflow menu for a wiki card. One line per card: all of the
 * permission/target logic lives in useWikiCardActions, and OverflowMenu
 * renders nothing when no actions qualify.
 */
export function WikiCardMenu(props: WikiCardMenuProps) {
  const { menuItems } = useWikiCardActions(props);
  return <OverflowMenu items={menuItems} label={props.label} />;
}
```

- [ ] **Step 2: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add app/components/wiki/shared/WikiCardMenu.tsx
git commit -m "feat(wiki): add the WikiCardMenu glue component"
```

---

### Task 10: Render private windows on the Tabletop

**Files:**

- Modify: `app/components/mainview/tabletop/TabletopView.tsx`

**Interfaces:**

- Consumes: `useTabletopPlayerState` (Task 6); the `cartyx:focus-window` event (Task 8).
- Produces: private windows render for their owner; a `cartyx:focus-window` listener that focuses and flashes.

- [ ] **Step 1: Merge private windows into the rendered set**

`TabletopView` already derives its window list from `activeScreen.windows`. Add the caller's private windows for the active screen:

```tsx
const privateWindows = (playerState?.privateWindows ?? []).filter(
  (pw) => pw.surface === 'tabletop' && pw.screenId === activeScreenId
);
```

Map them into the same shape the existing window renderer consumes, tagging them so the close handler can route correctly — e.g. `{ ...pw, isPrivate: true }` — and concatenate with the shared list. Private windows must render through the **same** collection branch as shared ones; do not duplicate the branch chain.

- [ ] **Step 2: Route close to the right mutation**

A private window's close must call `removePrivateWindow.mutate({ privateWindowId })`, **not** `closeWindow` (which is GM-only and would 403 for a player, and would close the shared window for everyone if it succeeded). Branch on the `isPrivate` tag in the existing close handler.

- [ ] **Step 3: Add the focus + flash listener**

`GMScreensView` already implements focus + flash via `setFlashWindowId` + a 700ms timer. Mirror that here and drive it from the event:

```tsx
useEffect(() => {
  const onFocus = (e: Event) => {
    const { surface, collection, documentId } = (e as CustomEvent).detail;
    if (surface !== 'tabletop') return;
    const match = allWindows.find(
      (w) => w.collection === collection && w.documentId === documentId
    );
    if (!match) return;
    setFlashWindowId(match.id);
    setTimeout(() => setFlashWindowId(null), 700);
  };
  window.addEventListener('cartyx:focus-window', onFocus);
  return () => window.removeEventListener('cartyx:focus-window', onFocus);
}, [allWindows]);
```

Also change the existing **drop** handler's duplicate branch (currently `// Already open — no flash/focus needed in Phase 1; return`) to focus + flash the same way, converging the two surfaces per spec decision 7.

- [ ] **Step 4: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/tabletop/TabletopView.tsx
git commit -m "feat(tabletop): render private windows and focus+flash duplicates"
```

---

### Task 11: Render private windows on GM Screens

**Files:**

- Modify: `app/components/mainview/gmscreens/GMScreensView.tsx`

**Interfaces:**

- Consumes: `useTabletopPlayerState` (Task 6, already wired in Task 7); the `cartyx:focus-window` event.
- Produces: private windows render for their owner on GM screens.

- [ ] **Step 1: Merge and route close**

Repeat Task 10's Steps 1–2 in this file, filtering on `pw.surface === 'gmscreen' && pw.screenId === activeScreenId`. Private-window close calls `removePrivateWindow.mutate({ privateWindowId })` rather than the GM-screens `closeWindow`.

- [ ] **Step 2: Handle the focus event**

This view already has `setFlashWindowId` and the 700ms timer from its drop handler. Add the same `cartyx:focus-window` listener as Task 10 Step 3, guarding on `surface !== 'gmscreen'`, and reuse the existing flash path rather than adding a second one.

- [ ] **Step 3: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/mainview/gmscreens/GMScreensView.tsx
git commit -m "feat(gmscreens): render private windows and honour focus requests"
```

---

### Task 12: Wire the menu into every card

**Files:**

- Modify: `app/components/wiki/characters/CharacterCard.tsx`
- Modify: `app/components/wiki/players/PlayerCard.tsx`
- Modify: `app/components/wiki/locations/LocationCard.tsx`
- Modify: `app/components/wiki/organizations/OrganizationCard.tsx`
- Modify: `app/components/wiki/quests/QuestCard.tsx`
- Modify: `app/components/wiki/calendar/EventCard.tsx`
- Modify: `app/components/wiki/lore/LoreCard.tsx`
- Modify: `app/components/wiki/races/RaceCard.tsx`
- Modify: `app/components/wiki/spells/SpellCard.tsx`
- Modify: `app/components/wiki/rules/RuleCard.tsx`
- Modify: `app/components/wiki/monsters/MonsterCard.tsx`

**Interfaces:**

- Consumes: `WikiCardMenu` (Task 9).
- Produces: every wiki card renders the menu.

**Note:** Calendar is intentionally absent — `CalendarPanel` renders a config view, not a list of cards (spec: Scope). Maps are done (Task 2).

- [ ] **Step 1: Add the menu to one card first**

Start with `LoreCard.tsx` — it is the only card with an existing unit test, so a regression shows up immediately. Wrap the card root in `group relative` if it is not already, and add:

```tsx
<div className="absolute right-2 top-2">
  <WikiCardMenu
    collection="lore"
    documentId={lore.id}
    label="Lore actions"
    canEdit={lore.canEdit}
    onEdit={() => onEdit?.(lore)}
    onDelete={() => onDelete?.(lore)}
  />
</div>
```

Each card passes the `collection` string **exactly as its existing drag payload does** — read the payload in the same file and copy the value. Note `EventCard` uses the plural `'events'`, unlike every other card.

Where a card has no `onEdit`/`onDelete` prop, add optional ones and have the parent panel pass its existing handlers — the panels already own edit/delete modals.

**`canEdit` is bimodal — check which model each collection uses before wiring it:**

| Collections                                                         | Source of `canEdit`                                               | Pass                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| characters, players, locations, lore, organizations, quests, events | server-computed `canEdit` on the list DTO (`isCreator \|\| isGM`) | `canEdit={item.canEdit}`        |
| races, rules, spells, monsters                                      | no DTO field — these panels gate edit on `isGM` alone             | `canEdit={isGM}` from the panel |

Passing `item.canEdit` on a collection that has no such field yields `undefined`, and
the Edit item silently never renders — a bug that type-checks. Verify the field exists
on the DTO before using the first form.

- [ ] **Step 2: Verify the LoreCard test still passes**

Run: `npx vitest run --project unit tests/components/wiki/lore/LoreCard.test.tsx`
Expected: PASS — the drag payload assertion is unaffected.

- [ ] **Step 3: Repeat for the remaining 10 cards**

Apply the same pattern to each card listed above, using its own collection string, id field, label, and handlers.

- [ ] **Step 4: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/wiki
git commit -m "feat(wiki): add the overflow menu to every wiki card"
```

---

### Task 13: Refactor ShowOnTabletopButton onto the hook

**Files:**

- Modify: `app/components/wiki/shared/ShowOnTabletopButton.tsx`

**Interfaces:**

- Consumes: `useWikiCardActions` (Task 8).
- Produces: unchanged public props — the 12 call sites are untouched.

**Why:** The button targets `screens[0]`, not the active screen. Routing it through the hook fixes that and removes the duplicate push logic.

- [ ] **Step 1: Rewrite the body**

Keep the props and the rendered button identical; replace the internals so the click delegates to the hook's push item:

```tsx
export function ShowOnTabletopButton({
  campaignId,
  collection,
  documentId,
  isGM,
}: ShowOnTabletopButtonProps) {
  const { menuItems } = useWikiCardActions({ collection, documentId });
  const push = menuItems.find((i) => i.key === 'push');

  if (!isGM || !push) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        push.onSelect();
      }}
      disabled={push.disabled}
      title={push.title}
      aria-label="Show on Tabletop"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-teal-400 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Monitor className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Show on Tabletop</span>
    </button>
  );
}
```

Delete the now-unused `useTabletopScreenList` / `useTabletopMutations` imports and the Phase 1 comment about targeting the first screen.

**Caveat:** the hook returns a `push` item only when the user is on the Tabletop or GM Screens tab. These modals open from the wiki, which is only reachable on those tabs, so this is fine — but if a modal is ever opened from the Dashboard the button will hide rather than misfire.

- [ ] **Step 2: Gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add app/components/wiki/shared/ShowOnTabletopButton.tsx
git commit -m "fix(wiki): target the active screen from ShowOnTabletopButton"
```

---

### Task 14: E2E — the shared-vs-private proof

**Files:**

- Create: `e2e/wiki/card-overflow-menu.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: the assertion no unit test can make.

**Why:** The entire point of the design is that Push is shared and Show on Tab is not. Only two browser contexts can prove it.

- [ ] **Step 1: Write the spec**

Create `e2e/wiki/card-overflow-menu.spec.ts`. The harness mints a **GM** cookie in `e2e/globalSetup.ts`; a second player context needs its own storage state — follow the token-minting pattern in `globalSetup.ts` to build one, or use two GM contexts and assert on shared-vs-private rather than on role.

Use **Quests**, not Characters: `QuestWindow` is one of the few window components
with a stable `data-testid` (`quest-window`). `FloatingWindow` itself has no testid,
and `CharacterWindow` has none either — do not invent one for the test.

```ts
import { test, expect, openWikiTab } from '../fixtures/tabletop-fixtures';
import { blockPartyKit } from '../fixtures/network-mocks';

test.describe('wiki card overflow menu', () => {
  test.beforeEach(async ({ page }) => {
    await blockPartyKit(page);
  });

  test('Push to Tabletop is visible in a second browser', async ({
    page,
    browser,
    campaignUrl,
  }) => {
    const other = await browser.newContext({ storageState: './e2e/.auth/storageState.json' });
    const otherPage = await other.newPage();
    await otherPage.goto(campaignUrl + '?tab=tabletop');

    await page.goto(campaignUrl + '?tab=tabletop');
    await openWikiTab(page);
    await page.getByRole('button', { name: 'Quests' }).click();
    await page.getByRole('button', { name: 'Quest actions' }).first().click();
    await page.getByTestId('overflow-item-push').click();

    // The other browser must see the shared window.
    await expect(otherPage.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });
    await other.close();
  });

  test('Show on Tab is NOT visible in a second browser', async ({ page, browser, campaignUrl }) => {
    const other = await browser.newContext({ storageState: './e2e/.auth/storageState.json' });
    const otherPage = await other.newPage();
    await otherPage.goto(campaignUrl + '?tab=tabletop');

    await page.goto(campaignUrl + '?tab=tabletop');
    await openWikiTab(page);
    await page.getByRole('button', { name: 'Quests' }).click();
    await page.getByRole('button', { name: 'Quest actions' }).first().click();
    await page.getByTestId('overflow-item-show-on-tab').click();

    // It appears for me…
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });
    // …and never for anyone else. Give the socket time to be wrong before asserting
    // absence, or this passes for the wrong reason (nothing has arrived YET).
    await otherPage.waitForTimeout(2000);
    await expect(otherPage.getByTestId('quest-window')).toHaveCount(0);
    await other.close();
  });

  test('a private window survives a reload', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl + '?tab=tabletop');
    await openWikiTab(page);
    await page.getByRole('button', { name: 'Quests' }).click();
    await page.getByRole('button', { name: 'Quest actions' }).first().click();
    await page.getByTestId('overflow-item-show-on-tab').click();
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId('quest-window').first()).toBeVisible({ timeout: 20_000 });
  });
});
```

**Both contexts here are the seeded GM** — `e2e/globalSetup.ts` only mints a GM
cookie. That still proves the shared-vs-private split (the whole point). It does
**not** prove the player-side permission matrix; that is covered by the
`useWikiCardActions` unit tests in Task 8. If a player cookie is wanted later,
follow the token-minting pattern in `globalSetup.ts`.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/wiki/card-overflow-menu.spec.ts --reporter=list`
Expected: 3 passed. Requires a seeded dev DB and a dev server on :3000.

If the run fails instantly with `ERR_EMPTY_RESPONSE`, a previous dev server is still
shutting down and Playwright reused a dying one. Start it yourself, poll until it
serves, then re-run:

```bash
npm run dev &
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 2; done
```

- [ ] **Step 3: Commit**

```bash
git add e2e/wiki/card-overflow-menu.spec.ts
git commit -m "test(e2e): prove push is shared and show-on-tab is private"
```

---

### Task 15: Documentation

**Files:**

- Modify: `docs/tabletop/README.md`
- Modify: `docs/tabletop/architecture.md`

- [ ] **Step 1: Update the docs**

In `docs/tabletop/README.md`, add **Private window** to Key Concepts:

```markdown
- **Private Window** -- A window only its owner can see, added from a wiki card's
  overflow menu ("Show on Tab"). Stored in `TabletopPlayerState.privateWindows`,
  never broadcast. Contrast with the shared windows on `TabletopScreen.windows[]`,
  which a GM opens for everyone ("Push to Tabletop").
```

Add `spell` to the Shipped list, and note that per-user private windows now exist.

In `docs/tabletop/architecture.md`, extend the Permissions table:

```markdown
| Show item on tab (private) | Y | Y | member check |
| Push item to tabletop (all) | Y | N | UI + server |
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write docs/tabletop/README.md docs/tabletop/architecture.md
git add docs/tabletop/README.md docs/tabletop/architecture.md
git commit -m "docs(tabletop): document private vs shared windows"
```

---

## Verification

After Task 15, run the full gate set:

```bash
npm run typecheck && npm run lint && npm test
(cd realtime && npm test)
npx playwright test e2e/wiki/ e2e/gmscreens/ e2e/tabletop/ --reporter=list
```

Then drive the real app (see the `verify` skill): as a GM, open a character's menu on the Tabletop, use **Show on Tab**, reload — the window must return. Use **Push to Tabletop** and confirm in a second browser. Switch to GM Screens and confirm **Show on Tab** targets the GM screen while **Push to Tabletop** still targets the tabletop.

## Known risks

- **Task 7 is the least contained change.** `GMScreensView` has 52 `activeScreenId` references and no player-state integration today. The GM-screens e2e suite is the guard.
- **Six-way registry sync (Task 3).** The schema test covers two of six; the render branches and hydration registries are covered only by e2e.
- **Tasks 10/11 touch two large files** (`TabletopView.tsx` ~29 KB). If the merge exceeds a few lines, extract it into a hook rather than growing them.
- **Players become window-capable for the first time.** Scoped to their own player-state document, but it is the one genuine permissions expansion here.
