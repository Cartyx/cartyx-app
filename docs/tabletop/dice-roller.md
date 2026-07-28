# Dice Roller

Interactive dice rolling from the tabletop toolbar (dice icon). Always available
— the old `VITE_PUBLIC_FF_*` PostHog gating was removed along with PostHog
itself, and the Inspector Dice tab now renders unconditionally.

## Usage

1. On the Tabletop view, click the dice icon in the left toolbar. A floating
   "Dice Roller" window opens (per-user, not shared, not persisted).
2. Click dice tiles (d100/d20/d12/d10/d8/d6/d4) to build a pool — a badge shows
   the queued count; clicking the badge removes one. **Reset** clears the pool.
3. Optional: set a modifier (−99…+99) and a roll mode (Normal / Adv / Dis).
   Advantage rolls the entire pool twice and keeps the higher total;
   disadvantage keeps the lower. The discarded set stays visible, struck
   through.
4. Choose **Public** (default) or **Private**, then **Roll**. The result always
   shows every individual die value so totals are verifiable.

Private rolls render only inside the window. Public rolls also appear in the
Inspector **Dice** tab for everyone in the active session, rendered with the
same card style as Beyond20 rolls, and are persisted to session history.

## Architecture

- `app/utils/dice.ts` — pure engine (`rollDice`, `formatPool`,
  `toParsedDiceRoll`). Crypto RNG with rejection sampling; injectable `rng`
  for deterministic tests.
- `app/components/mainview/DiceRollerPanel.tsx` — the window content; owns
  pool/modifier/mode/privacy state; renders the last result via
  `DiceRollCard` (`rollType: 'custom'` variant shows all die values and a
  "Result" label).
- `app/components/mainview/tabletop/toolWindowState.ts` — `dice` is a
  `ToolWindowId` in `WINDOW_ONLY_TOOLS`: a window toggle, not a map mode, so
  opening it does not change `activeTool` and there is nothing to revert.
  `TabletopView.tsx` renders it as a `<ToolWindow>` via
  `toolWindowManager.getWindowProps('dice')`.
- `app/utils/diceRollerBridge.ts` — window-event bridge. The panel emits
  `DiceBroadcastRequest`; `InspectorSidebar` (socket owner) relays it via the
  existing `useDiceRolls.sendDiceRoll` as a `DICE` message on the `main` party
  and answers with a `DiceDeliveryReport`. On failure the panel shows an inline
  notice and the roll stays local.

No server changes: the existing `DICE` wire type
(`realtime/src/parties/session.ts`), Mongo save path (`saveDiceRollSchema`), and
50-message room history are reused.

## Message flow (public roll)

DiceRollerPanel → rollDice() → toParsedDiceRoll() → requestDiceBroadcast()
→ InspectorSidebar onDiceBroadcastRequest → sendDiceRoll(socket) → the realtime
service's `main` party (validates, assigns seq, broadcasts) → all clients'
useDiceRolls → Dice tab DiceRollCard; the sender also persists the echoed roll
to Mongo.

## Testing

- Unit: `tests/utils/dice.test.ts`, `tests/utils/diceRollerBridge.test.ts`,
  `tests/components/mainview/DiceRollerPanel.test.tsx` (+ DicePanel, ToolBar,
  TabletopView, InspectorSidebar extensions).
- E2E: `e2e/tabletop/dice-roller.spec.ts` — mocks the `main` party WebSocket
  (HISTORY + DICE echo) since the Playwright web server doesn't run the realtime
  service. No env var or feature flag is required.
