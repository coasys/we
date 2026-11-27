/**
 * The dock kernel answers in geometry; the shell store hands the page CSS. These are the two
 * formatters between them: a box's lengths become `<n>px`, its rank a z-index above the panels'
 * band, and nothing else about it changes.
 */
import { describe, expect, it } from 'vitest';

import { PANEL_LAYER_BASE } from '../src/shared/dockGeometry';
import { dockStyleOf, dropSlotStyleOf } from '../src/shared/stores/shell/dockStyle';

describe('dockStyleOf', () => {
  it('writes each length in pixels and the rank as a z-index, and leaves the rest', () => {
    const style = dockStyleOf({
      edge: 'right',
      floating: false,
      handleX: 'left',
      top: 0,
      right: 0,
      width: 439.6,
      height: 900,
      padTop: 56,
      layoutWidth: 440,
      layer: 2,
      canStow: true,
    });
    expect(style).toEqual({
      edge: 'right',
      floating: false,
      handleX: 'left',
      top: '0px',
      right: '0px',
      width: '440px',
      height: '900px',
      padTop: '56px',
      layoutWidth: '440px',
      layer: PANEL_LAYER_BASE + 2,
      canStow: true,
    });
  });

  it('adds no length a box does not have', () => {
    expect(dockStyleOf({ edge: null, floating: true })).toEqual({ edge: null, floating: true });
  });
});

describe('dropSlotStyleOf', () => {
  it('writes the line in pixels and keeps the hit box as geometry', () => {
    const hit = { x: 0, y: 0, w: 40, h: 900 };
    expect(
      dropSlotStyleOf({
        index: 1,
        edge: 'left',
        mode: 'band',
        lane: '',
        key: 'k',
        top: 0,
        left: 80,
        width: 4,
        height: 900,
        hit,
      }),
    ).toEqual({
      index: 1,
      edge: 'left',
      mode: 'band',
      lane: '',
      key: 'k',
      top: '0px',
      left: '80px',
      width: '4px',
      height: '900px',
      hit,
    });
  });
});
