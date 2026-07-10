import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Regression guard for the dev outage where useTabletopParty/useTabletopMapParty
// connected to parties that were never declared in partykit.json, so every
// /parties/tabletop* WebSocket 404'd on dev, prod, AND local `partykit dev`.

const ROOT = path.resolve(__dirname, '../..');

interface PartykitConfig {
  main: string;
  parties?: Record<string, string>;
}

const config: PartykitConfig = JSON.parse(readFileSync(path.join(ROOT, 'partykit.json'), 'utf8'));

/**
 * Every party name referenced anywhere in app/: client connections via
 * usePartySocket({ party }) AND server-side HTTP broadcasts that build
 * `/parties/<name>/…` URLs by hand (e.g. maps.ts broadcastActiveMapChanged —
 * a stale name there 404s silently because the fetch error is swallowed).
 */
function referencedPartyNames(): string[] {
  const names = new Set<string>();
  const appDir = path.join(ROOT, 'app');
  for (const entry of readdirSync(appDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const src = readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    for (const m of src.matchAll(/party:\s*['"]([^'"]+)['"]/g)) {
      names.add(m[1]);
    }
    for (const m of src.matchAll(/\/parties\/([a-zA-Z0-9_-]+)\//g)) {
      names.add(m[1]);
    }
  }
  return [...names];
}

describe('partykit.json', () => {
  it('declares every party referenced by hooks or server-side broadcast URLs', () => {
    const declared = new Set(['main', ...Object.keys(config.parties ?? {})]);
    for (const name of referencedPartyNames()) {
      expect(declared, `party '${name}' is referenced in app/ but not declared`).toContain(name);
    }
  });

  it('points every declared party at an existing entry file', () => {
    const entries = [config.main, ...Object.values(config.parties ?? {})];
    for (const entry of entries) {
      expect(existsSync(path.join(ROOT, entry)), `${entry} does not exist`).toBe(true);
    }
  });

  it('uses party names PartyKit can build and validate', () => {
    // The config schema requires /^[a-z0-9_-]+$/, but the deploy codegen also
    // interpolates the name as a JS identifier (`import <name> from ...`), so
    // hyphens break the build. Underscore is the only safe separator.
    for (const name of Object.keys(config.parties ?? {})) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
