/**
 * Working copies of templates edited where another draws them — a section inside its shell.
 *
 * The theme editor's pattern: a draft the renderer prefers while it exists, keyed by a template's id
 * and origin (an agent's template and a space's may share an id). Each is a live document
 * (`liveTemplate.ts`) for the reason the template on screen is one: an edit deep in a section updates
 * the nodes it touched rather than handing the router a new section to remount.
 */
import type { ReactivityPort } from '@we/reactivity';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { ensureNodeIds } from '@we/schema-shared';

import type { LiveTemplate, LiveTemplates } from './liveTemplate';
import { deepClone } from './utils';

const keyOf = (t: { id?: string; _fromSpace?: boolean }) => `${t._fromSpace ? 'space' : 'own'}:${t.id ?? ''}`;

export interface TemplateDraftsDeps {
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>;
  liveTemplates: LiveTemplates;
  onInvalid?: (message: string) => void;
}

export function createTemplateDrafts({ reactivity, liveTemplates, onInvalid }: TemplateDraftsDeps) {
  const drafts = new Map<string, LiveTemplate>();
  /** Bumped as drafts open and close, so `draftOf` is reactive to which exist. */
  const [changed, setChanged] = reactivity.signal(0);
  const bump = () => setChanged(reactivity.untrack(changed) + 1);

  /** A template's working copy, opened from it; opening one twice answers with the same copy. */
  function openDraft(template: TemplateSchema): TemplateSchema {
    const key = keyOf(template);
    const open = drafts.get(key);
    if (open) return open.read();
    const clone = deepClone(template) as SchemaNode;
    ensureNodeIds(clone);
    const draft = liveTemplates(clone as TemplateSchema);
    drafts.set(key, draft);
    bump();
    return draft.read();
  }

  /** Replace a draft's contents in place, as `updateTemplate` does the template on screen. */
  function updateDraft(draft: TemplateSchema, next: TemplateSchema) {
    const open = drafts.get(keyOf(draft));
    if (!open) return;
    const clone = deepClone<TemplateSchema>(next);
    ensureNodeIds(clone, undefined, open.read());
    // Where it came from is part of which record it is, so an edit cannot drop it.
    if (open.read()._fromSpace) clone._fromSpace = true;
    const result = open.update(clone);
    if (!result.applied && result.errors?.length) onInvalid?.(result.errors[0].message);
  }

  /** Drop a draft: what draws it goes back to the saved template. */
  function closeDraft(draft: TemplateSchema) {
    if (drafts.delete(keyOf(draft))) bump();
  }

  /** The open draft of a template, if it has one — what draws it prefers this. */
  function draftOf(template: { id?: string; _fromSpace?: boolean }): TemplateSchema | undefined {
    changed();
    return drafts.get(keyOf(template))?.read();
  }

  return { openDraft, updateDraft, closeDraft, draftOf };
}
