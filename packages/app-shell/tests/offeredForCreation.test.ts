/**
 * Which built-in entities a "create something" picker offers.
 *
 * The picker listed every entity with a form, less `Relationship` by name — so `RelationshipType`,
 * which has a form for the vocabulary screen, appeared on the workshop canvas's double-click. Creating
 * one there wrote a kind of connection with no slug, for the whole space, as a card. A declaration
 * rather than a second name, so the next vocabulary entity says it once in its own manifest.
 */
import { offeredForCreation } from '@shared/shapes/recordDraft';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

const offered = (name: string) => offeredForCreation(CORE_MANIFEST.entities[name]);

describe('the create picker', () => {
  it('offers the content types a person fills in', () => {
    for (const name of ['TaskBlock', 'EventBlock', 'LinkBlock', 'LocationBlock']) expect(offered(name)).toBe(true);
  });

  it('leaves out what is made somewhere specific, while keeping its form', () => {
    for (const name of ['Relationship', 'RelationshipType']) {
      expect(CORE_MANIFEST.entities[name].authoring?.fields.length).toBeGreaterThan(0);
      expect(offered(name)).toBe(false);
    }
  });

  it('leaves out what has no form at all', () => {
    expect(offered('CollectionBlock')).toBe(false);
    expect(offered('SignalType')).toBe(false);
  });
});
