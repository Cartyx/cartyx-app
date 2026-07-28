/**
 * Who may open which collection in a PRIVATE window.
 *
 * Shared by BOTH sides on purpose:
 *  - the client, so the overflow menu never offers a "Show on Tab" the server
 *    is going to reject (see useWikiCardActions)
 *  - the server, which is the one that actually enforces it (see
 *    tabletop-hydration.ts and addPrivateWindow)
 *
 * Model-free by design — the client imports this, so it must never pull in
 * mongoose. Everything here is a pure predicate over names and plain fields.
 */

/**
 * Collections whose documents are GM-only in their entirety. `getTabletopScreen`
 * already drops monster windows outright for players; events carry GM plot
 * content the same way.
 */
export const GM_ONLY_COLLECTIONS: ReadonlySet<string> = new Set(['monster', 'events']);

/**
 * Collections a non-GM may never hydrate through the PRIVATE-window path.
 *
 * `note` is here rather than isPublic-filtered because `Note.isPublic` defaults
 * to `false` and the note fetcher does not select the field. Selecting it would
 * change what the SHARED path returns for note windows, so notes fail closed
 * for non-GMs instead.
 */
export const PRIVATE_DENIED_FOR_PLAYERS: ReadonlySet<string> = new Set([
  ...GM_ONLY_COLLECTIONS,
  'note',
]);

/** Whether `collection` may be hydrated at all on the private-window path. */
export function canHydratePrivately(collection: string, isGM: boolean): boolean {
  return isGM || !PRIVATE_DENIED_FOR_PLAYERS.has(collection);
}

/**
 * Collections where a non-GM may ALSO see their own non-public document.
 *
 * Mirrors the `$or: [{ isPublic: true }, { createdBy: userId }]` filter that
 * each of these collections' list/get functions applies — e.g. `listLore` +
 * `getLore`, `listCharacters` + `getCharacter`. A player legitimately sees
 * their own private lore/character in the wiki, so a window on it must hydrate
 * or the card's menu action would silently do nothing.
 *
 * `rule` is DELIBERATELY absent: `listRules`/`getRule` give a non-GM public
 * rules only, with no creator exception. `race`, `spell` and `player` carry no
 * `isPublic` at all and so never reach this check.
 */
export const CREATOR_VISIBLE_COLLECTIONS: ReadonlySet<string> = new Set([
  'character',
  'location',
  'lore',
  'organization',
  'quest',
]);

/**
 * Whether a non-GM viewer may see this document through a private window.
 *
 * `isPublic === undefined` means the collection has no such field (race, spell,
 * player) — those are visible to every member, so only an explicit `false`
 * denies.
 */
export function isVisibleOnPrivatePath(
  collection: string,
  doc: { isPublic?: boolean; createdBy?: string },
  viewerUserId: string
): boolean {
  if (doc.isPublic !== false) return true;
  return CREATOR_VISIBLE_COLLECTIONS.has(collection) && doc.createdBy === viewerUserId;
}
