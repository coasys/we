/**
 * Does the space tier actually fit a space template?
 *
 * The tier split is only defensible if a real template can be written inside it. A boundary drawn
 * where the useful work is on the other side is not a security boundary — it is a list of things
 * every template has to be granted an exception for, and exceptions granted routinely stop being
 * decisions.
 *
 * So this asserts against WE's own bundled templates: whatever a deployment ships, none of it may
 * need chrome powers. When that stops being true the answer is a considered one — move the member
 * into the space tier because a community template legitimately needs it, or change the template —
 * and this failing is what forces the question to be asked.
 *
 * Shell surfaces (settings, the marketplace, the profile page) are excluded by name. They *are*
 * chrome, they render at `CHROME_TIER`, and asking them to fit the space tier would be asking the
 * app to be unable to sign anybody out.
 */
import { describe, expect, it } from 'vitest';

import { dockFrame } from '../src/shared/registries/dockRegistry';
import { templateRegistry } from '../src/shared/registries/templateRegistry';
import { CHROME_TIER, inspectTemplateSurface, SPACE_TIER } from '../src/shared/registries/templateSurface';
import {
  bootScreen,
  chromeRail,
  landingPageTemplate,
  marketplaceTemplate,
  profileTemplate,
  sidebar,
  templateEditor,
} from '../src/shared/schemas';

/** Templates that are host chrome rather than a space's UI, and are rendered at the chrome tier. */
const CHROME_TEMPLATES = new Set(['launcher']);

const bundled = Object.entries(templateRegistry as Record<string, unknown>);

describe('the bundled templates', () => {
  it('finds some, so the assertions below are not vacuous', () => {
    expect(bundled.length).toBeGreaterThan(0);
  });

  it.each(bundled.filter(([id]) => !CHROME_TEMPLATES.has(id)))('%s fits the space tier', (_id, template) => {
    const { blocked } = inspectTemplateSurface(template, SPACE_TIER);
    expect(blocked.map((reference) => reference.path)).toEqual([]);
  });

  it.each(bundled)('%s refers only to things that exist', (_id, template) => {
    // A blocked reference with a null group is not "you may not have that" — it is a member nobody
    // has classified, which for a template written in this repo means a typo or a store member that
    // was renamed without the templates following. Caught at the widest tier so the only thing
    // under test is existence.
    const unknown = inspectTemplateSurface(template, CHROME_TIER).blocked.filter((r) => r.group === null);
    expect(unknown.map((reference) => reference.path)).toEqual([]);
  });
});

/**
 * The half this test was missing, and the bug that found it.
 *
 * Chrome is schema too. `dockRegistry.dockFrame` builds a docked panel's frame — its geometry, and
 * the drag handle that resizes it — out of `$store` and `$action` references, exactly like a
 * template does. Marking those store members `WIRING` therefore did not mean "the host keeps this
 * to itself"; it meant *nothing could reach them*, and every docked panel rendered as empty space
 * with no resize rail. The call module's video dock is the one that got noticed.
 *
 * Covering only `templateRegistry` left that whole class invisible, because the bundled templates
 * are the one kind of schema that never touches host furniture. So this asserts against everything
 * the shell actually renders.
 *
 * Note what is *not* here: the settings-page and schema-tests views that build their own store
 * objects and merge them over the chrome bag. Their references cannot be judged against the
 * manifest, because the objects they name are assembled at mount.
 */
describe('the chrome the shell renders', () => {
  const CHROME_SCHEMAS: Array<[string, unknown]> = [
    ['sidebar', sidebar],
    ['chromeRail', chromeRail],
    ['templateEditor', templateEditor],
    ['bootScreen', bootScreen],
    ['profile', profileTemplate],
    ['marketplace', marketplaceTemplate],
    ['landingPage', landingPageTemplate],
    // One docked panel, on one edge. The frame is identical for every module and every edge — what
    // is under test is which store members it names, not the geometry it computes from them.
    ['a docked panel', dockFrame({ id: 'call', edge: 'left' } as never, { type: 'Column' } as never)],
  ];

  it.each(CHROME_SCHEMAS)('%s can reach everything it names', (_name, schema) => {
    const { blocked } = inspectTemplateSurface(schema, CHROME_TIER);
    expect(blocked.map((reference) => reference.path)).toEqual([]);
  });

  it('a docked panel names the dock members, so the assertion above is not vacuous', () => {
    // A `dockFrame` that stopped using `$store` would make its case pass by naming nothing at all.
    const { allowed } = inspectTemplateSurface(
      dockFrame({ id: 'call', edge: 'left' } as never, { type: 'Column' } as never),
      CHROME_TIER,
    );
    const paths = allowed.map((reference) => reference.path);

    expect(paths).toContain('shellStore.beginDockResize');
    expect(paths.some((path) => path.startsWith('shellStore.dockGeometry.'))).toBe(true);
  });

  it('keeps the app furniture out of a space template', () => {
    // The other direction: `host-layout` is chrome-tier, so a template cannot move the app's docks.
    const { blocked } = inspectTemplateSurface(
      dockFrame({ id: 'call', edge: 'left' } as never, { type: 'Column' } as never),
      SPACE_TIER,
    );
    expect(blocked.map((reference) => reference.path)).toContain('shellStore.beginDockResize');
  });
});
