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
      /*
        The reply is the VIEWER'S OWN, which is what puts the edit and delete controls on the line —
        they are gated on `author == me.did`, and faded rather than unmounted, so they take their
        room whether or not the pointer is anywhere near. A thread of other people's replies is the
        uncrowded case and says nothing about the crowded one.
      */
      { id: 'r1', parentId: 'card-1', author: 'did:me', createdAt: '2026-09-01T10:00:00Z', editorState: null },
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
        { did: 'did:them', name: 'Theodora Fairweather', avatar: '' },
        // Two words, and long enough that the row genuinely runs short inside a panel. A name that
        // fits is a name that proves nothing.
        { did: 'did:me', name: 'Alexandra Whitfield', avatar: '' },
      ],
    },
  },
});

/**
 * Two nested boxes, each of which varies by state. The smallest shape the design system's
 * `--we-ds-*` indirection can be wrong about.
 *
 * `hoverProps` moves the outer row's ordinary props out of its inline style into custom properties,
 * and custom properties inherit — so the inner row, which also has a state bag and so reads the
 * same vars, used to pick up `--we-ds-width: 100%` from its ancestor and fill the line. Nothing in
 * either row's own declaration says anything about its width.
 *
 * Deliberately not a fragment: this is a fact about the interop stylesheet, and stating it in
 * fourteen nodes is what keeps the next reader from thinking it is about comment threads.
 */
const nestedInteractive = (): Scenario => ({
  node: {
    type: 'Row',
    props: { width: '100%', ay: 'center', gap: '200', hoverProps: { opacity: 1 } },
    children: [
      { type: 'we-text', children: ['A name beside it'] },
      {
        type: 'Row',
        props: { gap: '100', ay: 'center', flexShrink: '0', focusProps: { opacity: 1 } },
        children: [
          { type: 'we-button', props: { variant: 'ghost', size: 'sm', square: true }, children: ['A'] },
          { type: 'we-button', props: { variant: 'ghost', size: 'sm', square: true }, children: ['B'] },
        ],
      },
    ],
  },
  tables: {},
});

export const scenarios: Record<string, () => Scenario> = {
  'discussion:thread': discussionThread,
  'ds:nested-interactive': nestedInteractive,
};
