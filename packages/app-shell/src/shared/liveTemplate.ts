/**
 * A template the renderer is drawing, as the stores hold it: a handle on a live document.
 *
 * The template on screen, and each working copy of a section, is a tree edited in place, so that an
 * edit redraws the one node it touched rather than handing the renderer a new tree to mount again.
 * Doing that needs fine-grained reactivity over a nested object, or a renderer that diffs trees
 * itself — either way it is the renderer's business, not the stores'. So a store asks the renderer's
 * adapter for a live document and holds this handle; under Solid the document is a nested store
 * (`frameworks/solid/stores/liveTemplate.ts`), and another framework brings its own.
 *
 * What a store may rely on is only what is written here. Reading the tree inside a reactive scope
 * follows what was read, however finely the implementation tracks it.
 */
import type { ReactivityPort } from '@we/reactivity';
import type { TemplateSchema, ValidationError } from '@we/schema-shared';
import { findMutations, validateStructure } from '@we/schema-shared';

/** Whether an update was put in, and if not, what the validator said. */
export interface LiveTemplateUpdate {
  applied: boolean;
  errors?: ValidationError[];
}

export interface LiveTemplate {
  /**
   * The tree as it is drawn. Read inside a reactive scope, it follows what was read; an
   * implementation may hand back the same object across edits, so a caller holding it sees them.
   */
  read(): TemplateSchema;
  /**
   * Change it into `next`, touching only what differs, so what did not change keeps its mount and
   * everything it holds. Refused, and the tree left alone, when `next` does not validate.
   */
  update(next: TemplateSchema): LiveTemplateUpdate;
  /** Put `next` in its place whole — a different template, rather than an edit of this one. */
  replace(next: TemplateSchema): void;
}

/** Opens a live document on a tree: what the renderer's adapter lends the stores. */
export type LiveTemplates = (initial: TemplateSchema) => LiveTemplate;

/**
 * Live documents for a host whose renderer redraws a tree it is handed whole: each edit replaces the
 * tree, so a reader of any part of it wakes on every edit. Correct on any reactivity port, and
 * coarser than a renderer that tracks nodes — what the stores' tests run on beside Solid's.
 */
export function plainLiveTemplates(reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>): LiveTemplates {
  return (initial) => {
    const [tree, setTree] = reactivity.signal(initial);
    return {
      read: tree,
      update(next) {
        const { valid, errors } = validateStructure(next);
        if (!valid) return { applied: false, errors };
        if (findMutations(reactivity.untrack(tree), next).length) setTree(next);
        return { applied: true };
      },
      replace: setTree,
    };
  };
}
