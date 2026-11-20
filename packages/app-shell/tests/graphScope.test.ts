/**
 * An inbound graph read — "what points at these through `about`" — as the backend answers it.
 *
 * The shared relation reader asks backward with `scope: { direction: 'in', anchorId: [...] }`. The
 * model layer has no such read, so the host used to answer it by scanning two hundred candidates and
 * filtering — which is also why the canvas seed avoided it. A child's own to-one pointer needs no
 * scan: the read is `where: { about: [...] }`, which both backends answer natively and the live test
 * reads on an executor.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { inboundAsWhere } from '../src/shared/graphScope';

const prop = (name: string, extra: Partial<EntityManifestEntry['properties'][number]> = {}) => ({
  name,
  predicate: `x://${name}`,
  type: 'uri' as const,
  isCollection: false,
  required: false,
  writable: true,
  ...extra,
});

const MANIFEST: EntityManifestEntry[] = [
  {
    name: 'Position',
    targetClass: 'x://Position',
    properties: [
      prop('about', { relatedEntity: 'Topic' }),
      prop('tags', { relatedEntity: 'Tag', isCollection: true }),
      prop('topic', { relatedEntity: 'Topic', reverse: true }),
    ],
  },
];

describe('inboundAsWhere', () => {
  it('reads a to-one pointer at a list of anchors as a where over the list', () => {
    expect(
      inboundAsWhere(MANIFEST, 'Position', { anchor: 'Topic', via: 'about', anchorId: ['t1', 't2'], direction: 'in' }),
    ).toEqual({
      about: ['t1', 't2'],
    });
  });

  it('reads one anchor as a plain equality', () => {
    expect(
      inboundAsWhere(MANIFEST, 'Position', { anchor: 'Topic', via: 'about', anchorId: 't1', direction: 'in' }),
    ).toEqual({
      about: 't1',
    });
  });

  it('leaves a list, a reverse read, an outbound scope and an unknown relation to the other paths', () => {
    const scope = { anchor: 'Topic', anchorId: 't1', direction: 'in' as const };
    expect(inboundAsWhere(MANIFEST, 'Position', { ...scope, via: 'tags' })).toBeUndefined();
    expect(inboundAsWhere(MANIFEST, 'Position', { ...scope, via: 'topic' })).toBeUndefined();
    expect(inboundAsWhere(MANIFEST, 'Position', { ...scope, via: 'nope' })).toBeUndefined();
    expect(inboundAsWhere(MANIFEST, 'Position', { anchor: 'Topic', via: 'about', anchorId: 't1' })).toBeUndefined();
    expect(inboundAsWhere(MANIFEST, ['Position'], { ...scope, via: 'about' })).toBeUndefined();
  });
});
