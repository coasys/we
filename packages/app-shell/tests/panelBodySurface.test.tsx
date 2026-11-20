/**
 * `surface` in a template's panel body — lent the way the bag is.
 *
 * A route reads the template's surface through `RouteSurface` because routes run under the layout's
 * owner. A panel body does not: `PanelHost` draws it beside the chrome, so `surface.tier` read as
 * undefined inside every panel — the same silent false the routes had before `buildRoutes` carried
 * the surface to them. `TemplateLayout` lends its surface over the module scope, and the body's
 * render context picks it up; the Coasys tree folds its own lane on a phone off this read.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatePanelBody } from '../src/frameworks/solid/components/TemplatePanelBody';
import { provideTemplateBag, provideTemplateSurface } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';

let release: (() => void)[] = [];

beforeEach(() => {
  release = [provideTemplateBag({} as never)];
  setTemplatePanels(
    [
      {
        id: 'tree',
        title: 'Tree',
        home: 'tree',
        node: {
          type: 'span',
          props: { class: 'tree-body' },
          children: [{ $: "surface.tier ?? 'none'" }],
        },
      },
    ],
    'surface-test',
  );
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
  release.forEach((done) => done());
  release = [];
});

describe('a template panel body reading the surface', () => {
  it('sees the lent surface — the template’s own boundary, out of the layout’s owner reach', async () => {
    release.push(provideTemplateSurface({ width: 390, tier: 'base' }));
    const { container } = render(() => <TemplatePanelBody panelId="tree" />);
    await vi.waitFor(() => expect(container.querySelector('.tree-body')?.textContent).toBe('base'));
  });

  it('reads nothing where no template surface was lent', async () => {
    const { container } = render(() => <TemplatePanelBody panelId="tree" />);
    await vi.waitFor(() => expect(container.querySelector('.tree-body')?.textContent).toBe('none'));
  });
});
