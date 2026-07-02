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

/** Every party name the client connects to via usePartySocket({ party }). */
function hookPartyNames(): string[] {
  const hooksDir = path.join(ROOT, 'app', 'hooks');
  const names = new Set<string>();
  for (const file of readdirSync(hooksDir)) {
    if (!/\.tsx?$/.test(file)) continue;
    const src = readFileSync(path.join(hooksDir, file), 'utf8');
    for (const m of src.matchAll(/party:\s*['"]([^'"]+)['"]/g)) {
      names.add(m[1]);
    }
  }
  return [...names];
}

describe('partykit.json', () => {
  it('declares every party the client hooks connect to', () => {
    const declared = new Set(['main', ...Object.keys(config.parties ?? {})]);
    for (const name of hookPartyNames()) {
      expect(declared, `party '${name}' is used by a hook but not declared`).toContain(name);
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
