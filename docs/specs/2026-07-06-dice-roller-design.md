# Virtual Dice Roller — Design Spec

**Date:** 2026-07-06
**Branch:** `virtual-dice` (PR targets `dev`)
**Status:** Approved design, pending implementation plan

## Summary

An interactive dice roller for Cartyx, opened from the existing dice icon in the
tabletop toolbar. Players build a pool of standard dice, apply a modifier, roll
with normal/advantage/disadvantage, and choose whether the result stays private
or broadcasts to the session's Dice feed — where it renders exactly like the
existing DnD Beyond/Beyond20 roll cards.

Today the `dice` toolbar tool is a no-op and dice content only arrives from the
Beyond20 browser extension. This feature makes Cartyx capable of rolling
natively while reusing the existing dice infrastructure end to end.

## Requirements

- Dice types: **d100, d20, d12, d10, d8, d6, d4**.
- Pool of multiple dice (e.g. 3d6 + 1d8) rolled together; the result MUST show
  each individual die value, not just the total — players won't trust an
  unexplained number.
- Roll modes: **Normal**, **Advantage** (roll the pool twice, keep the higher
  total), **Disadvantage** (keep the lower). Both attempts remain visible; the
  discarded one is dimmed.
- Signed integer **modifier** added to the final total (clamped to −99…+99).
- **Public/Private** toggle, default Public. Private renders only in the roller
  window. Public also broadcasts to the session Dice feed (Inspector Dice tab),
  styled like Beyond20 rolls, labeled with the roller's name and the roll
  expression (e.g. "3d6 + 1d8 + 3, Advantage").
- Opened from the toolbar dice icon as a floating window, like other windows.
- Gated behind the existing `VITE_PUBLIC_FF_DICE` PostHog feature flag (same
  gate as the Inspector Dice tab). Toolbar icon hidden when the flag is off.
- Tabletop view only for now (that is where the toolbar lives).

## Chosen approach

**Local ephemeral window + reuse of the existing DICE pipeline.** Rolls are
generated client-side (consistent with the Beyond20 trust model already
accepted by the app). Public rolls travel over the existing `DICE` PartyKit
wire type — no new parties, wire types, or chat-schema changes.

Alternatives considered and rejected:

- **Server-authoritative rolls** (PartyKit generates values): cheat-proof but
  adds wire types, latency, and test complexity; stricter than the existing
  Beyond20 trust model. Can be layered on later without UI changes.
- **Persisted shared window** (server `openWindow` mutation, like monster
  windows): schema changes for what is a per-user utility; a dice roller is
  not a shared document.

## UI & interaction

**Opening.** Clicking the toolbar dice button (`data-testid="tool-dice"`,
`Dices` icon) toggles a singleton floating window open/focused. It does NOT
enter a tool mode — the previously active tool (pointer/hand/…) stays active.

**`DiceRollerPanel` contents:**

- **Dice grid** — seven tiles (d100, d20, d12, d10, d8, d6, d4). Click a tile
  to add one die of that type to the pool; a count badge on the tile shows the
  queued quantity. Clicking the badge removes one die of that type. **Reset**
  clears the whole pool.
- **Modifier** — +/− numeric stepper, default 0, clamped −99…+99, applied once
  to the final total.
- **Roll mode** — segmented control: Normal / Advantage / Disadvantage.
- **Privacy toggle** — Public / Private, default Public.
- **Roll button** — disabled while the pool is empty. On roll, the window shows
  the final total prominently with the full breakdown beneath it, e.g.
  `d6: 4, 3, 6 · d8: 5 · +3 = 21`. For advantage/disadvantage both roll sets
  are shown; the discarded set is dimmed/struck-through.

**Result destinations.** Private: window only; nothing leaves the client.
Public: window + broadcast to the Dice feed rendered by the existing
`DiceRollCard`/`RollBreakdown` components.

## Architecture

Three new/changed pieces:

1. **`app/utils/dice.ts` — pure rolling engine.**
   - Pool type: `{ sides: 100 | 20 | 12 | 10 | 8 | 6 | 4; count: number }[]`.
   - `rollDice({ pool, mode, modifier, rng? })` returns: all roll sets (two for
     advantage/disadvantage, one for normal), every individual die value,
     the index of the winning set, subtotal, and final total.
   - `rng` is injectable for deterministic tests; production uses
     `crypto.getRandomValues` with rejection sampling to avoid modulo bias.
   - No React, no I/O.

2. **`app/components/mainview/DiceRollerPanel.tsx` — window content.**
   Renders the UI above; owns only UI state (pool, modifier, mode, privacy,
   last result); receives a "send public roll" callback. Storybook story
   alongside, like sibling components.

3. **Wiring in `app/components/mainview/tabletop/TabletopView.tsx`.**
   - `diceRollerOpen` state; selecting the `dice` tool flips it and the tool
     selection immediately reverts to the previous tool (dice acts as a
     button, not a mode — change threaded through `play.tsx`/`MainView` where
     `activeTool` lives).
   - When open, a singleton `ManagedWindow` (`id: 'dice-roller'`) containing
     `<DiceRollerPanel/>` is appended to `localWindows`. It deliberately skips
     the server `openWindow` mutation: per-user, ephemeral, closes on reload,
     never syncs to other players.
   - Toolbar dice button visibility gated via
     `useOptionalFeatureFlag(import.meta.env.VITE_PUBLIC_FF_DICE)`.

**Public roll data flow.** Roll result → mapped to the existing `DiceMessage`
shape (`party/index.ts` already lists `DICE` in `validTypes`) → sent via the
existing `useDiceRolls` send path over the PartyKit `main` party → all
connected clients' Dice tabs render it via `DiceRollCard`; the party persists
the last 50 rolls to room history. No changes to `party/index.ts`,
`partykit.json`, or `app/types/schemas/chat.ts`.

## Error handling

- Empty pool → Roll button disabled (never an error state).
- Public roll while the PartyKit socket is disconnected: the roll still
  completes and displays locally, with an inline notice ("couldn't broadcast —
  not connected"). A roll is never blocked or lost due to network state.
- Modifier input sanitized/clamped; non-numeric input impossible via stepper.

## Testing

- **Unit (Vitest, `app/utils/dice.test.ts`):** per-die bounds over many rolls
  (d100 ∈ 1–100 etc.); pool totals sum correctly; advantage keeps the higher
  set / disadvantage the lower (deterministic injected RNG); modifiers
  including negative totals; empty-pool rejection; roll-result →
  `DiceMessage` mapping produces a shape the party validator accepts.
- **Component (Storybook + vitest):** `DiceRollerPanel` stories — empty,
  queued pool with badges, normal result, advantage result with dimmed
  discarded set, disconnected-broadcast notice.
- **E2E (Playwright, `e2e/tabletop/dice-roller.spec.ts`):** follows the
  monster-window spec pattern. `mockPostHog` with the dice flag added to
  `e2e/fixtures/network-mocks.ts`. Flow: open campaign → click `tool-dice` →
  window opens → queue 3d6 + modifier → roll → assert total and three
  individual die values render → private mode behaves as specified. Public
  path: assert the roll card appears in the Dice tab (real dev PartyKit if the
  e2e web server provides it; otherwise assert the outbound socket message via
  mock — the implementation plan decides based on what `npm run dev` runs).
- **Gate before PR:** unit + component + e2e green, plus a manual smoke test
  in the running app.

## Documentation

- Feature doc: `docs/tabletop/dice-roller.md` (usage, architecture, message
  flow), following the existing `docs/tabletop/` structure.
- This spec: `docs/specs/2026-07-06-dice-roller-design.md`.

## Out of scope

- Server-authoritative (cheat-proof) rolls.
- 3D dice animation.
- GM Screens view surface.
- Roll history inside the roller window (public history already lives in the
  Dice tab; the window shows only the latest result).
- New chat channels or chat message types.
