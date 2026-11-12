/**
 * Every class a space has, grouped by where it comes from: the space's own models, each other app's
 * namespace, and WE's built-ins — nothing hidden because WE did not write it.
 */
import { describe, expect, it } from 'vitest';

import { classOrigin, groupSpaceClasses } from '../src/shared/shapes/spaceClasses';

const known = [
  { value: 'Sighting', label: 'Sighting', icon: 'binoculars', group: 'This space' },
  { value: 'TaskBlock', label: 'Task', icon: 'check-square', group: 'Built in' },
  { value: 'TextBlock', label: 'Text', icon: 'text-t', group: 'Built in' },
];

describe('classOrigin', () => {
  it('names a namespace by its scheme, and a web IRI by its host', () => {
    expect(classOrigin('conv://DiscussionTopic')).toBe('conv://');
    expect(classOrigin('flux://Channel')).toBe('flux://');
    expect(classOrigin('https://schema.org/Person')).toBe('https://schema.org');
    expect(classOrigin('urn:example:Thing')).toBe('urn:');
    expect(classOrigin('')).toBe('');
  });
});

describe('groupSpaceClasses', () => {
  it("lists another app's classes under their namespace, hinted ones first", () => {
    const groups = groupSpaceClasses({
      known,
      foreign: [
        { name: 'Question', targetClass: 'conv://Question' },
        { name: 'DiscussionTopic', targetClass: 'conv://DiscussionTopic', interpretationHint: 'A subject.' },
        { name: 'Channel', targetClass: 'flux://Channel' },
      ],
    });
    expect(groups.map((g) => g.label)).toEqual(['This space', 'conv://', 'flux://', 'WE']);
    expect(groups[1].classes.map((c) => [c.name, c.hinted])).toEqual([
      ['DiscussionTopic', true],
      ['Question', false],
    ]);
    expect(groups[1].classes[1]).toMatchObject({ label: 'Question', icon: 'cube' });
  });

  it("keeps WE's own and the space's own models as the record lists know them", () => {
    const groups = groupSpaceClasses({ known, foreign: [] });
    expect(groups).toEqual([
      {
        key: 'space',
        label: 'This space',
        classes: [{ name: 'Sighting', label: 'Sighting', icon: 'binoculars', hinted: false }],
      },
      {
        key: 'we',
        label: 'WE',
        classes: [
          { name: 'TaskBlock', label: 'Task', icon: 'check-square', hinted: false },
          { name: 'TextBlock', label: 'Text', icon: 'text-t', hinted: false },
        ],
      },
    ]);
  });

  it('lists a foreign class once, and not again where a known model already has its name', () => {
    const groups = groupSpaceClasses({
      known,
      foreign: [
        { name: 'Sighting', targetClass: 'birds://Sighting' },
        { name: 'Nest', targetClass: 'birds://Nest' },
        { name: 'Nest', targetClass: 'birds://Nest' },
      ],
    });
    expect(groups.find((g) => g.label === 'birds://')?.classes.map((c) => c.name)).toEqual(['Nest']);
  });

  it("leaves WE's own plumbing out, wherever its shape came from", () => {
    const groups = groupSpaceClasses({
      known: [],
      foreign: [
        { name: 'Space', targetClass: 'old://Space' },
        { name: 'Answer', targetClass: 'old://Answer' },
      ],
    });
    expect(groups).toEqual([
      { key: 'old://', label: 'old://', classes: [{ name: 'Answer', label: 'Answer', icon: 'cube', hinted: false }] },
    ]);
  });

  it('gathers a class with no readable namespace under Other', () => {
    const groups = groupSpaceClasses({ known: [], foreign: [{ name: 'Loose', targetClass: '' }] });
    expect(groups.map((g) => [g.key, g.label])).toEqual([['other', 'Other']]);
  });
});
