/**
 * What the browser harness can mount.
 *
 * A scenario is the real schema — the same fragment or template the app renders, imported rather
 * than restated — plus the rows a seeded backend should answer with. Nothing here describes layout;
 * the assertions live beside the cases, so one scenario can be measured several ways.
 */
import type { SchemaNode } from '@we/schema-shared';
import { discussionSection } from '@we/template-kit';

export interface Scenario {
  /** The schema to mount, exactly as the app would render it. */
  node: SchemaNode;
  /** Rows the in-memory backend answers with, by entity. */
  tables: Record<string, Record<string, unknown>[]>;
  /** How those rows relate, so a scoped query resolves the way it does against a real backend. */
  relations?: Record<string, Record<string, { type: 'hasOne' | 'hasMany'; target: string; foreignKey: string }>>;
  /** Host store members the schema reads. Merged over the harness's own defaults. */
  stores?: Record<string, unknown>;
}

/**
 * A comment thread in an inspector panel — the case this harness was built for.
 *
 * A long name and a comment with replies, which is the combination that crowds the byline: face,
 * name, time, a fold stub and a pair of controls, all on one line inside a panel.
 */
const discussionThread = (): Scenario => ({
  node: {
    type: '$each',
    props: { items: [{ id: 'card-1', comments: ['r1'] }], as: 'row' },
    $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
    children: [discussionSection({ record: 'row' })],
  },
  tables: {
    SignalType: [],
    CollectionBlock: [
      { id: 'card-1', parentId: null, author: 'did:me', createdAt: '2026-09-01T09:00:00Z' },
      { id: 'r1', parentId: 'card-1', author: 'did:them', createdAt: '2026-09-01T10:00:00Z', editorState: null },
      { id: 'r2', parentId: 'r1', author: 'did:them', createdAt: '2026-09-01T11:00:00Z', editorState: null },
    ],
  },
  relations: {
    CollectionBlock: {
      comments: { type: 'hasMany', target: 'CollectionBlock', foreignKey: 'parentId' },
      inReplyTo: { type: 'hasOne', target: 'CollectionBlock', foreignKey: 'parentId' },
    },
  },
  stores: {
    profileStore: {
      profiles: [
        { did: 'did:them', name: 'Alexandra Whitfield', avatar: '' },
        { did: 'did:me', name: 'James', avatar: '' },
      ],
    },
  },
});

export const scenarios: Record<string, () => Scenario> = {
  'discussion:thread': discussionThread,
};
