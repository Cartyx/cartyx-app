import { describe, it, expect } from 'vitest';
import { MapAoE } from '~/server/db/models/MapAoE';
describe('MapAoE model', () => {
  it('is exported and defined', () => {
    expect(MapAoE).toBeDefined();
  });
});
