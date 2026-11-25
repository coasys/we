/**
 * What the editing session edits — kept apart from what is on screen.
 *
 * Every edit used to read and write `templateStore.currentTemplate`, which made "the template being
 * edited" and "the template on screen" the same thing by construction. They are not: a section is
 * drawn by the shell on screen and is a template of its own, and so is the app around both. Editing
 * either in place, where it is seen, needs the session to name its target and every editing path —
 * the inspector, the overlay, the cards, the code panel, the AI's patches, undo, saving — to go
 * through that name rather than through `currentTemplate`.
 *
 * Not members of the editor store, which is public API every template can reach: this is the
 * editor's own plumbing. It is composed with the stores at `BootController` and reached the way
 * they are, as `editTarget` in the registry, which no template bag is built from.
 */
import type { Accessor, ReactivityPort } from '@we/reactivity';
import type { TemplateSchema } from '@we/schema-shared';

import { appTemplateRegistry } from '../registries/appTemplates';
import type { TemplateStore } from './TemplateStore';

/** What the edit target asks of the template store: the template on screen, and working copies. */
export type EditTargetTemplates = Pick<
  TemplateStore,
  | 'currentTemplate'
  | 'updateTemplate'
  | 'openDraft'
  | 'updateDraft'
  | 'closeDraft'
  | 'persistTemplate'
  | 'isBuiltInTemplateId'
>;

/**
 * The template on screen, or a section the shell on screen draws — edited through its working copy,
 * which the shell draws in its place while it is the target (`TemplateStore.openDraft`).
 */
export type EditTarget =
  | { kind: 'screen' }
  | { kind: 'section'; id: string; name: string; draft: TemplateSchema }
  /** The app around every space — its working copy is what the chrome is drawn from while edited. */
  | { kind: 'app'; draft: TemplateSchema };

export interface EditTargetPort {
  /** What is being edited. */
  target: Accessor<EditTarget>;
  /** Edit a section where its shell draws it, from the template the shell draws it from. */
  enterSection: (id: string, saved: TemplateSchema) => void;
  /** Edit the app the agent is in, where it is drawn: around everything. */
  enterApp: (saved: TemplateSchema) => void;
  /** Back to the template on screen. A section's working copy is dropped; its edits are saved already. */
  leave: () => void;
  /** Its working copy — a store, so the renderer and the editor read it finely. */
  template: () => TemplateSchema;
  /** Replace its working copy, keeping the store's identity. */
  update: (next: TemplateSchema) => void;
  /** Save its working copy to its own record. */
  persist: () => Promise<void>;
  /** It ships with the app, so editing it means forking it. */
  isBuiltIn: () => boolean;
  /**
   * Which history it has. A space's template and an agent's can share an id, so the origin is part
   * of the key: two templates' undo must never be one stack.
   */
  key: () => string;
}

export function createEditTarget({
  reactivity,
  templateStore,
}: {
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>;
  templateStore: EditTargetTemplates;
}): EditTargetPort {
  const { signal, untrack } = reactivity;
  const [target, setTarget] = signal<EditTarget>({ kind: 'screen' });
  // An action reads the target untracked, so an effect that calls one does not come to depend on it.
  const template = (): TemplateSchema => {
    const now = target();
    return now.kind === 'screen' ? templateStore.currentTemplate : now.draft;
  };
  const leave = () => {
    const now = untrack(target);
    if (now.kind !== 'screen') templateStore.closeDraft(now.draft);
    setTarget({ kind: 'screen' });
  };
  return {
    target,
    enterSection: (id, saved) => {
      leave();
      setTarget({ kind: 'section', id, name: saved.meta?.name ?? id, draft: templateStore.openDraft(saved) });
    },
    enterApp: (saved) => {
      leave();
      setTarget({ kind: 'app', draft: templateStore.openDraft(saved) });
    },
    leave,
    template,
    update: (next) => {
      const now = untrack(target);
      if (now.kind === 'screen') templateStore.updateTemplate(next);
      else templateStore.updateDraft(now.draft, next);
    },
    persist: () => templateStore.persistTemplate(template()),
    isBuiltIn: () => {
      const edited = template();
      const id = edited.id;
      /*
        WE's own app ships with the build as the built-in templates do, so editing it forks it too.
        And so does anything an installed app brought (`source`): it stays that app's, so a later
        version can replace it and removing the app takes it — changing it means a copy of your own.
      */
      return !!id && (templateStore.isBuiltInTemplateId(id) || id in appTemplateRegistry || !!edited.source);
    },
    key: () => {
      const edited = template();
      return `${edited._fromSpace ? 'space' : 'own'}:${edited.id ?? ''}`;
    },
  };
}
