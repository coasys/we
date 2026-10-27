/**
 * The switch in Settings → Developer shows a developer what a user sees, and a user of a production
 * build is offered no showcase template or theme. So with the switch off, the pickers leave them out.
 */
import { SHOWCASE_THEME_PRESETS } from '@we/themes/presets';
import { describe, expect, it } from 'vitest';

import { offeredInPickers } from '../src/shared/devOnlyOffers';
import { bundledTemplates, devOnlyTemplateIds } from '../src/shared/registries/bundledTemplates.generated';
import { devOnlyThemeIds } from '../src/shared/registries/themeRegistry';

describe('what a picker offers', () => {
  const items = [{ id: 'default' }, { id: 'workshop' }, { id: 'discord' }, { id: 'trello' }];
  const devOnly = new Set(['discord', 'trello']);

  it('leaves out the developer features while the tools are hidden, and nothing else', () => {
    expect(offeredInPickers(items, false, devOnly).map((i) => i.id)).toEqual(['default', 'workshop']);
  });

  it('offers everything while they are showing', () => {
    expect(offeredInPickers(items, true, devOnly).map((i) => i.id)).toEqual([
      'default',
      'workshop',
      'discord',
      'trello',
    ]);
  });
});

/*
  The sets the stores filter by. These tests run as a build with developer features, so both hold
  something; in a production build both are empty, and their templates and themes are not there to
  offer. A template marked `dev` in the catalogue and missing here would show with the switch off.
*/
describe('the developer-feature ids', () => {
  it('name every bundled template but Default and Workshop', () => {
    const shipped = Object.keys(bundledTemplates).filter((id) => !devOnlyTemplateIds.has(id));
    expect(shipped.sort()).toEqual(['default', 'workshop']);
  });

  it('name the showcase themes', () => {
    expect([...devOnlyThemeIds].sort()).toEqual(Object.keys(SHOWCASE_THEME_PRESETS).sort());
  });
});
