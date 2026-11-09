/**
 * Vector tile decoder (lib/mvt.ts) — what the street map reads out of a tile.
 *
 * Node-clean: pure byte handling. Registered in vitest.node-specs.mjs.
 */
import { describe, it, expect } from 'vitest';
import { decodeGeometry, decodeTile, MvtError } from '../src/lib/mvt';
import { geom, mvtTile } from './helpers/street-map-fixtures';

describe('mvt | geometry', () => {
  it('decodes points, lines and closes rings', () => {
    expect(decodeGeometry(geom(1, [[[25, 17]]]))).toEqual([[[25, 17]]]);
    expect(
      decodeGeometry(
        geom(2, [
          [
            [2, 2],
            [2, 10],
            [10, 10],
          ],
        ])
      )
    ).toEqual([
      [
        [2, 2],
        [2, 10],
        [10, 10],
      ],
    ]);
    const ring = decodeGeometry(
      geom(3, [
        [
          [3, 6],
          [8, 12],
          [20, 34],
          [3, 6],
        ],
      ])
    );
    expect(ring).toEqual([
      [
        [3, 6],
        [8, 12],
        [20, 34],
        [3, 6],
      ],
    ]);
  });

  it('refuses a truncated or unknown command', () => {
    expect(() => decodeGeometry([9, 50])).toThrow(MvtError);
    expect(() => decodeGeometry([(1 << 3) | 4, 0, 0])).toThrow(MvtError);
    expect(() => decodeGeometry([(1 << 3) | 2, 2, 2])).toThrow(/LineTo before MoveTo/);
  });
});

describe('mvt | tiles', () => {
  const tile = mvtTile([
    {
      name: 'buildings',
      features: [
        {
          type: 3,
          props: { kind: 'building' },
          parts: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      ],
    },
    {
      name: 'roads',
      extent: 4096,
      features: [
        {
          type: 2,
          props: { kind: 'highway', name: 'I-90', oneway: true, min_zoom: 5, width: -2, sort: 1.5 },
          parts: [
            [
              [0, 2048],
              [4096, 2048],
            ],
          ],
        },
      ],
    },
    {
      name: 'places',
      extent: 512,
      features: [
        { type: 1, props: { kind: 'locality', name: 'Blue Island' }, parts: [[[256, 256]]] },
      ],
    },
  ]);

  it('decodes the asked-for layers with their properties, and skips the rest', () => {
    const layers = decodeTile(tile, new Set(['roads', 'places']));
    expect(layers.map((l) => l.name)).toEqual(['roads', 'places']);
    const [roads, places] = layers;
    expect(roads!.extent).toBe(4096);
    expect(roads!.features[0]).toEqual({
      type: 2,
      props: { kind: 'highway', name: 'I-90', oneway: true, min_zoom: 5, width: -2, sort: 1.5 },
      geometry: [
        [
          [0, 2048],
          [4096, 2048],
        ],
      ],
    });
    expect(places!.extent).toBe(512);
    expect(places!.features[0]!.props.name).toBe('Blue Island');
  });

  it('an empty wanted set decodes nothing', () => {
    expect(decodeTile(tile, new Set())).toEqual([]);
  });

  it('refuses a truncated tile', () => {
    expect(() => decodeTile(tile.slice(0, tile.length - 7), new Set(['places']))).toThrow(MvtError);
  });
});
