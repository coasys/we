/**
 * A stored template never takes the id of a template or a section this build ships.
 *
 * Copying a section into a space carries the original's id. Built-in sections were not reserved, so
 * a copy of About was saved as `about`, lost to the built-in when the space's sections resolved, and
 * edits to it went nowhere anybody could see.
 */
import { reservedTemplateIds } from '@shared/registries/reservedTemplateIds';
import { viewRegistry } from '@shared/registries/viewRegistry';
import { reserveId } from '@shared/templateIdentity';
import { describe, expect, it } from 'vitest';

describe('the ids a stored template may not take', () => {
  it('include every built-in section', () => {
    const reserved = reservedTemplateIds();
    for (const id of Object.keys(viewRegistry)) expect(reserved).toContain(id);
  });

  it('turn a copy of About into a fork of it, not a second About', () => {
    expect(Object.keys(viewRegistry)).toContain('about');
    const id = reserveId('about', reservedTemplateIds());
    expect(id).not.toBe('about');
    expect(id.startsWith('about-')).toBe(true);
  });
});
