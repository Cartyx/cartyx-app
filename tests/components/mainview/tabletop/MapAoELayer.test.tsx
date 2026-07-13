import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MapAoELayer } from '~/components/mainview/tabletop/MapAoELayer';
import type { MapAoEData } from '~/types/mapAoe';

function aoe(over: Partial<MapAoEData>): MapAoEData {
  return {
    id: 'a',
    mapId: 'm',
    campaignId: 'c',
    shape: 'sphere',
    originX: 100,
    originY: 100,
    sizePx: 40,
    rotation: 0,
    color: '#ff0000',
    createdBy: 'u',
    createdByName: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('MapAoELayer', () => {
  it('renders a circle for a sphere and a polygon for a cone', () => {
    const { container } = render(
      <MapAoELayer
        visible
        aoes={[aoe({ id: 's', shape: 'sphere' }), aoe({ id: 'k', shape: 'cone' })]}
        preview={null}
        effectiveScale={1}
        imageOffsetX={0}
        imageOffsetY={0}
      />
    );
    expect(container.querySelector('[data-aoe-id="s"]')?.tagName.toLowerCase()).toBe('circle');
    expect(container.querySelector('[data-aoe-id="k"]')?.tagName.toLowerCase()).toBe('polygon');
    expect(container.querySelector('circle')?.getAttribute('fill-opacity')).toBe('0.3');
  });
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <MapAoELayer
        visible={false}
        aoes={[aoe({})]}
        preview={null}
        effectiveScale={1}
        imageOffsetX={0}
        imageOffsetY={0}
      />
    );
    expect(queryByTestId('map-aoe-layer')).toBeNull();
  });
  it('draws the placer name and optional label as semi-transparent text', () => {
    const { getByTestId, getByText } = render(
      <MapAoELayer
        visible
        aoes={[aoe({ id: 'x', createdByName: 'Ada Lovelace', label: 'Fireball' })]}
        preview={null}
        effectiveScale={1}
        imageOffsetX={0}
        imageOffsetY={0}
      />
    );
    const labelLayer = getByTestId('map-aoe-label-layer');
    expect(labelLayer).toBeTruthy();
    const name = getByText('Ada Lovelace');
    const spell = getByText('Fireball');
    expect(name.tagName.toLowerCase()).toBe('text');
    // Semi-transparent so tokens/terrain underneath stay visible.
    expect(Number(name.getAttribute('fill-opacity'))).toBeLessThan(1);
    expect(Number(spell.getAttribute('fill-opacity'))).toBeLessThan(1);
  });
  it('omits the label layer when a template has no name or label', () => {
    const { queryByTestId } = render(
      <MapAoELayer
        visible
        aoes={[aoe({ id: 'x', createdByName: '', label: undefined })]}
        preview={null}
        effectiveScale={1}
        imageOffsetX={0}
        imageOffsetY={0}
      />
    );
    expect(queryByTestId('map-aoe-label-layer')).toBeNull();
  });
});
