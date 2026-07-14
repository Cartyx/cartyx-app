import { vi } from 'vitest';

/*
 * This repo's vitest unit project never talks to a real (or in-memory) Mongo —
 * tests/setup.ts globally mocks `mongoose` itself, and there is no
 * mongodb-memory-server / real-Mongo harness anywhere in this codebase (see
 * memory `reference_seed_ephemeral_mongo`: "the vitest unit suite does not
 * use a real Mongo"). Server-function tests that need real create → read →
 * update → delete round-trips therefore back their model mocks with a tiny
 * in-memory, array-backed fake that emulates just the Mongoose query shapes
 * those functions use (plain equality, dotted paths into embedded
 * docs/arrays, $or/$and, $elemMatch, $all, $in, $set, $pull). This file
 * factors that fake out of quests.test.ts so later suites (Task 4's
 * Character/Player/Location/Organization/Event server-function tests) can
 * reuse it instead of re-deriving the same operator semantics.
 */

function get(obj: unknown, key: string): unknown {
  return (obj as Record<string, unknown> | null | undefined)?.[key];
}

export function matchDoc(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, val]) => {
    if (key === '$or') return (val as Record<string, unknown>[]).some((f) => matchDoc(doc, f));
    if (key === '$and') return (val as Record<string, unknown>[]).every((f) => matchDoc(doc, f));
    if (key === '$text') return true;

    if (key.includes('.')) {
      const [head, ...rest] = key.split('.');
      const restKey = rest.join('.');
      const headVal = get(doc, head);
      if (Array.isArray(headVal)) {
        return headVal.some((el) => matchDoc(el as Record<string, unknown>, { [restKey]: val }));
      }
      return matchDoc((headVal as Record<string, unknown>) ?? {}, { [restKey]: val });
    }

    const actual = get(doc, key);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const ops = val as Record<string, unknown>;
      if ('$elemMatch' in ops) {
        const arr = (actual as unknown[]) ?? [];
        return arr.some((item) =>
          matchDoc(item as Record<string, unknown>, ops.$elemMatch as Record<string, unknown>)
        );
      }
      if ('$in' in ops) return (ops.$in as unknown[]).includes(actual);
      if ('$all' in ops) {
        const arr = (actual as unknown[]) ?? [];
        return (ops.$all as unknown[]).every((v) => arr.includes(v));
      }
    }
    return actual === val;
  });
}

export function chain<T>(result: T) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.sort = () => q;
  q.limit = () => q;
  q.lean = async () => result;
  return q;
}

// Deep-clones a doc the way JSON.parse(JSON.stringify(...)) would (dropping
// function-valued properties like the fake's own `.save`/`.toObject`), but —
// unlike JSON round-tripping — preserves `Date` instances instead of turning
// them into ISO strings, so production's `iso()` helper (`d instanceof
// Date`) sees real Dates on round-trip instead of always falling back to ''.
export function clone<T>(d: T): T {
  return cloneValue(d) as T;
}

function cloneValue(v: unknown): unknown {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(cloneValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'function') continue;
      out[k] = cloneValue(val);
    }
    return out;
  }
  return v;
}

/**
 * Build a fake Mongoose-model-shaped object backed by an in-memory array.
 * Supports both `new Model(doc)` (Quest-style, with `.save()`/`.toObject()`)
 * and the static methods the quest (and future entity) server functions use:
 * find/findById/findOne/findOneAndUpdate/create/updateMany/deleteOne/deleteMany.
 *
 * `prefix` seeds generated `_id`s (e.g. 'q' -> 'q1', 'q2', ...) so ids stay
 * readable and collision-free across a test file's fakes.
 */
export function createFakeModel(prefix: string) {
  const docs: Record<string, unknown>[] = [];
  let seq = 1;
  const nextId = () => `${prefix}${seq++}`;

  function Model(this: Record<string, unknown>, doc: Record<string, unknown>) {
    Object.assign(this, { _id: nextId(), ...doc });
    this.save = vi.fn(async () => {
      docs.push(clone(this));
      return this;
    });
    this.toObject = () => clone(this);
  }

  Object.assign(Model, {
    create: async (doc: Record<string, unknown>) => {
      const rec = { _id: nextId(), ...doc };
      docs.push(rec);
      return rec;
    },
    deleteMany: async (filter: Record<string, unknown> = {}) => {
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matchDoc(docs[i], filter)) docs.splice(i, 1);
      }
      return {};
    },
    find: (filter: Record<string, unknown> = {}) =>
      chain(docs.filter((d) => matchDoc(d, filter)).map(clone)),
    findOne: (filter: Record<string, unknown>) => {
      const found = docs.find((d) => matchDoc(d, filter));
      return chain(found ? clone(found) : null);
    },
    findById: (id: string) => {
      const found = docs.find((d) => d._id === id);
      return chain(found ? clone(found) : null);
    },
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> }
    ) => {
      const idx = docs.findIndex((d) => matchDoc(d, filter));
      if (idx === -1) return chain(null);
      Object.assign(docs[idx], update.$set ?? {});
      return chain(clone(docs[idx]));
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const idx = docs.findIndex((d) => matchDoc(d, filter));
      if (idx >= 0) docs.splice(idx, 1);
      return { deletedCount: idx >= 0 ? 1 : 0 };
    },
    updateMany: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $pull?: Record<string, unknown> }
    ) => {
      for (const d of docs) {
        if (!matchDoc(d, filter)) continue;
        if (update.$set) Object.assign(d, update.$set);
        if (update.$pull) {
          for (const [field, cond] of Object.entries(update.$pull)) {
            const arr = (d[field] as unknown[]) ?? [];
            d[field] = arr.filter(
              (item) => !matchDoc(item as Record<string, unknown>, cond as Record<string, unknown>)
            );
          }
        }
      }
      return {};
    },
  });

  return Model as unknown as {
    new (doc: Record<string, unknown>): Record<string, unknown>;
    create: (doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
    deleteMany: (filter?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    find: (filter?: Record<string, unknown>) => ReturnType<typeof chain>;
    findOne: (filter: Record<string, unknown>) => ReturnType<typeof chain>;
    findById: (id: string) => ReturnType<typeof chain>;
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> }
    ) => ReturnType<typeof chain>;
    deleteOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown>>;
    updateMany: (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $pull?: Record<string, unknown> }
    ) => Promise<Record<string, unknown>>;
  };
}

// A read-only stub for models the quest functions only ever `findOne` for
// label-resolution and never write to in these tests (Player, Location,
// Organization, Event).
export function createNotFoundModel() {
  return { findOne: () => chain(null) };
}
