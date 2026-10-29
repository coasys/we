/**
 * Nothing WE ships has a box shaped as a control that holds nothing to press.
 *
 * `r: 'control'` is the shape of the things you press, and a theme with pill buttons (Coasys Glow)
 * makes everything in that family a pill. Boxes kept borrowing it — the create-space dialog's note,
 * a task's waiting line — and turned up as pills one theme at a time. The validator warns about it in
 * a template; this runs the same rule over what the validator is not run on: the host's own dialogs
 * and surfaces, and every template, view and bundle built in.
 */
import { controlShapedBoxes } from '@we/schema-shared';
import * as shell from '@we/template-shell';
import { describe, expect, it } from 'vitest';

import { bundledTemplates } from '../src/shared/registries/bundledTemplates.generated';
import { bundledViews } from '../src/shared/registries/bundledViews.generated';
import { seedBundles } from '../src/shared/registries/seedBundles.generated';

const found = (named: Record<string, unknown>) =>
  Object.entries(named).flatMap(([name, value]) => controlShapedBoxes(value).map((path) => `${name}${path}`));

describe('a box shaped as a control', () => {
  it('is nowhere in the host’s own surfaces', () => {
    expect(found(shell as Record<string, unknown>)).toEqual([]);
  });

  it('is nowhere in a template, view or bundle built in', () => {
    expect(found(bundledTemplates)).toEqual([]);
    expect(found(bundledViews)).toEqual([]);
    expect(found(Object.fromEntries(seedBundles.map((bundle) => [bundle.id, bundle])))).toEqual([]);
  });
});
