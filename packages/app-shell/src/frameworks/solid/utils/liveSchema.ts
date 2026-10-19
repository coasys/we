/**
 * liveSchema — a schema derived from another, kept so that an edit to the source reaches the
 * screen as an edit.
 *
 * Some render sites draw a *derivation* of the template rather than the template itself: the root
 * with its `$part` markers expanded is the one that matters. `resolveParts` copies every node on
 * the way to a part and keeps everything else by reference, so what the renderer is handed is
 * partly a plain copy. And the renderer reads the node it is given once, when it mounts. So the
 * copied part of the tree — workshop's top bar, which holds the call module's controls — was
 * frozen at first render: an edit there saved, and appeared only after a reload. A sibling still
 * shared with the store moved under it, which is how a single insert once took the bar down
 * entirely.
 *
 * So the derivation is kept in a store of its own, and every re-derivation is applied to it with
 * `updateSchema`, the same diff an edit to the template goes through. What changed is written in
 * place, a node that only moved keeps its component, and the renderer only ever sees this one
 * store.
 *
 * The derivation is copied before it is applied, so this store never shares an object with the
 * source: two stores holding one object would each believe it was theirs to change.
 */
import { deepClone } from '@shared/utils';
import type { SchemaNode } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { createEffect, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';

export function createLiveSchema<T extends SchemaNode>(derive: () => T): T {
  const [schema, setSchema] = createStore<T>(deepClone(untrack(derive)));
  createEffect(() => {
    const next = deepClone(derive());
    // Untracked: reading the store here would make every write to it re-run this.
    untrack(() => updateSchema(schema, next, setSchema));
  });
  return schema;
}
