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

import { templateRegistry } from '../src/shared/registries/templateRegistry';
import { CHROME_TIER, inspectTemplateSurface, SPACE_TIER } from '../src/shared/registries/templateSurface';

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
