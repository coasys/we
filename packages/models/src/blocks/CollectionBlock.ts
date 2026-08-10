import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { WeNode } from '../WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://collection_block' })
  flag: string = '';

  @HasMany({ through: 'we://children' })
  children: string[] = [];

  @Property({ through: 'we://editor_state', resolveLanguage: FILE_STORAGE_LANGUAGE })
  editorState: string | null = null;

  @Property({ through: 'we://type' })
  type: string = '';

  /**
   * What this collection *is* — `'call'`, `'notes'`, later `'board'`. Semantic, and deliberately
   * separate from `type`.
   *
   * `type` is the **Lexical node type** (`root`, `collection`, …), which the serializer round-trips
   * and the editor interprets. It has been doing double duty as a discriminator — `type: 'root'`
   * currently means "is a post" — and overloading it further would put semantic values into a
   * structural field, which is the mistake the transcribe module made writing `tag: 'transcript'`
   * into `TextBlock.tag` (a field that means `ul`/`h1`).
   *
   * A scalar rather than a tag relation because this is the field you *query by*:
   * `where: { kind: 'call' }` is a native `eq` that pushes down and composes with `order`/`limit`,
   * whereas tag membership would need a reverse traversal WE does not wire up. Tags remain for user
   * taxonomy — what a thing is *about*, not what surface owns it.
   *
   * Excluded from Lexical serialization via `AD4M_ONLY_PROPS`, so it never leaks into `editorState`.
   *
   * Posts predate this field and are still identified by `type: 'root'`; the composer now also writes
   * `kind: 'post'` so new posts carry both, and the read side can switch once the legacy set stops
   * mattering. **A `CollectionBlock` with `type: 'root'` and no `kind` is a post.**
   */
  @Property({ through: 'we://kind' })
  kind: string = '';

  /**
   * What this collection is called, and what it is about — set by whoever owns it, not derived.
   *
   * On the shared model rather than per kind because they are the two pieces of metadata *every*
   * collection can have: a call, a notes collection, a board. Kind-specific state (a board's column
   * config, say) does not belong here and should not accumulate as more scalars — that is what a
   * per-kind model or a JSON bag is for.
   *
   * Scalars for the same reason `kind` is one: these are fields you query by. `where: { title:
   * { contains: … } }` pushes down to the backend and composes with `order` and `limit`, and a list
   * can sort by title. Held in `editorState` or a blob they would be invisible to all of that — and
   * a call has no `editorState` at all, since the transcribe module creates it rather than the
   * composer.
   *
   * Distinct from `textContent`, which is derived from the children for search and preview: a title
   * written there would be overwritten by the next reconcile.
   *
   * Unset costs nothing — an AD4M property is a link that exists only once written — so collections
   * that never get named carry no storage, and no migration was needed to add these.
   */
  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://display' })
  display: string = '';

  @Property({ through: 'we://direction' })
  direction: string = '';

  @Property({ through: 'we://format' })
  format: string = '';

  @Property({ through: 'we://indent' })
  indent: number = 0;

  @Property({ through: 'we://columns' })
  columns: number = 0;

  @Property({ through: 'we://gap' })
  gap: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;

  @Property({ through: 'we://text_content' })
  textContent: string = '';
}

export interface CollectionBlock extends HasManyMethods<'children'> {}
