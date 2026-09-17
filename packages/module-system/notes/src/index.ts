/**
 * The notes module — private notes that follow you between spaces.
 *
 * ## What a note is
 *
 * A post in the agent's personal space. Not a `Note` entity (the module's first shape, a string), and
 * not a `TextBlock` in a space's notes collection (its second): a composition, written with the same
 * composer a post is, and able to hold whatever a post can — pictures, links, lists, a poll. See
 * `entities.ts` for why the kind is a post's rather than a note's own.
 *
 * ## Why the personal space
 *
 * A note used to be written into whichever space was on screen, which made it a scratchpad the whole
 * community could read — and a note written in one space was nowhere to be found in the next. Notes
 * are where half-formed things go; somebody writing one should not have to wonder who else can see
 * it. Shared thinking already has a form, and it is a post. So notes are private, one list wherever
 * you are, and the step from a note to a post is explicit: **share**, which copies it into the space
 * on screen.
 *
 * ## Owning a container, not the content
 *
 * The rule this module settled on in its second shape still holds, one level up: the content is the
 * shared vocabulary — a collection of blocks — and what the module owns is only what is true of
 * notes and of nothing else, which is the record of where one was shared (`NoteShare`). Organising
 * notes into folders is the Pocket's, reached by dragging a note into it; neither module names the
 * other.
 *
 * ## Why it has a store now
 *
 * It was the module that proved a module could be *entirely declaration*. A note being a composition
 * ended that — writing one is the host's document write, reached through a kernel — and sharing is a
 * read followed by a write somewhere else. `store.ts` says what each piece is for. The no-store shape
 * is still the right first shape for a module that can be one; `pnpm create-module` scaffolds it.
 */
import { defineModule, type ModuleDefinition, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { NOTE_KIND, NOTE_PREDICATES, NOTES_MANIFEST } from './entities';
import { panel, toggleButton } from './Panel.schema';
import { createNotesStore } from './store';

export { NOTE_KIND, NOTE_PREDICATES, NOTES_MANIFEST };
export { createNotesStore };

export const notesModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'notes',
    name: 'Notes',
    description: 'Private notes that follow you between spaces. Share one into a space as a post.',
    icon: 'note',
    /**
     * The agent's, not a community's: notes live in the personal space and are the same list in every
     * space, so no space's decision could apply to them. Turning them off is Settings → Modules.
     */
    scope: 'agent',
    // No `frameworks` — every piece of UI is a fragment. `agentData` for the notes themselves;
    // `records` for the one write into a space, which is sharing.
    requires: { kernels: ['agentData', 'records'] },
  },

  contributes: {
    // Installed into the personal space, beside the notes it describes.
    entities: { manifest: NOTES_MANIFEST, scope: 'agent' },

    parts: { toggleButton },

    /**
     * The panel. The host holds whether it is open, draws its rail button from `icon` and `title`, and
     * remembers wherever somebody drags it. `right` because that is the edge the module rail is on.
     */
    panels: [{ name: 'main', title: 'Notes', icon: 'note', node: panel, bid: { edge: 'right', size: 'md' } }],
  },

  createStore: (deps: ModuleStoreDeps) => createNotesStore(deps),
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => notesModule;
