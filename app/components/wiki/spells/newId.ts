/** Client-only unique id for editable list rows (not persisted as an ObjectId). */
export function newId(): string {
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
