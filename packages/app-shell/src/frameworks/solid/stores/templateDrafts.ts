/**
 * Working copies of templates edited where another draws them — a section inside its shell.
 *
 * The theme editor's pattern: a draft the renderer prefers while it exists, keyed by a template's id
 * and origin (an agent's template and a space's may share an id). A Solid store rather than a plain
 * object, for the reason `currentTemplate` is one: an edit deep in a section updates the nodes it
 * touched rather than handing the router a new section to remount.
 */
import { deepClone } from '@shared/utils';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { ensureNodeIds } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { createSignal } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';

const keyOf = (t: { id?: string; _fromSpace?: boolean }) => `${t._fromSpace ? 'space' : 'own'}:${t.id ?? ''}`;

export function createTemplateDrafts(opts: { onInvalid?: (message: string) => void } = {}) {
  const drafts = new Map<string, { draft: TemplateSchema; set: SetStoreFunction<TemplateSchema> }>();
  /** Bumped as drafts open and close, so `draftOf` is reactive to which exist. */
  const [changed, setChanged] = createSignal(0);

  /** A template's working copy, opened from it; opening one twice answers with the same copy. */
  function openDraft(template: TemplateSchema): TemplateSchema {
    const key = keyOf(template);
    const open = drafts.get(key);
    if (open) return open.draft;
    const clone = deepClone(template) as SchemaNode;
    ensureNodeIds(clone);
    const [draft, set] = createStore<TemplateSchema>(clone as TemplateSchema);
    drafts.set(key, { draft, set });
    setChanged((n) => n + 1);
    return draft;
  }

  /** Replace a draft's contents in place, as `updateTemplate` does the template on screen. */
  function updateDraft(draft: TemplateSchema, next: TemplateSchema) {
    const open = drafts.get(keyOf(draft));
    if (!open) return;
    const clone = deepClone(next) as TemplateSchema;
    ensureNodeIds(clone as SchemaNode, undefined, open.draft as SchemaNode);
    // Where it came from is part of which record it is, so an edit cannot drop it.
    if (open.draft._fromSpace) clone._fromSpace = true;
    const result = updateSchema(open.draft, clone, open.set);
    if (!result.applied && result.errors?.length) opts.onInvalid?.(result.errors[0].message);
  }

  /** Drop a draft: what draws it goes back to the saved template. */
  function closeDraft(draft: TemplateSchema) {
    if (drafts.delete(keyOf(draft))) setChanged((n) => n + 1);
  }

  /** The open draft of a template, if it has one — what draws it prefers this. */
  function draftOf(template: { id?: string; _fromSpace?: boolean }): TemplateSchema | undefined {
    changed();
    return drafts.get(keyOf(template))?.draft;
  }

  return { openDraft, updateDraft, closeDraft, draftOf };
}
