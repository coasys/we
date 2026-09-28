/**
 * What the notes store does that the panel's fragments cannot.
 *
 * ## Why notes have a store at all
 *
 * They had none. A note was a `TextBlock` written with `record.create` into the space on screen, and
 * everything else was a `$query`. Two things ended that:
 *
 * - **A note is a composition now.** Writing one is a collection, a record per block, its files
 *   uploaded, its text indexed — the host's document write, reached through a kernel. `record.create`
 *   writes one record, and a template composing the rest from those would be a second copy of the
 *   block system's persistence.
 * - **Sharing is a read, then a write somewhere else.** Read the note out of the personal space with
 *   its files resolved, write it into the space on screen, and remember that it happened. A schema
 *   has no way to carry a value from one of those to the next.
 *
 * ## Private, all of it
 *
 * Nothing here is marked. The panel renders at the chrome tier and sees every member; a space's
 * template sees none. That is the point: every action writes into, or reads out of, somebody's
 * personal space, and a template synced in from a community must not be able to file a note for
 * them — or copy one out.
 */
import { parseRef } from '@we/backend-shared';
import type { ComposedDocument, ModuleStoreDeps } from '@we/module-shared';

import { NOTE_KIND } from './entities';

/** A share as the store reads it back. */
interface ShareRow {
  id: string;
  noteId?: string;
}

export function createNotesStore(deps: ModuleStoreDeps) {
  const { signal } = deps;

  /** Which note is being written: `'new'` for a first save, a note's id for an edit, empty when idle. */
  const [saving, setSaving] = signal('');
  /** The note being copied into a space, or empty. */
  const [sharing, setSharing] = signal('');
  const [lastError, setLastError] = signal('');

  // Read at call time, not captured: the kernels forward to host services that arrive after boot.
  const personal = () => deps.kernels.agentData;
  const space = () => deps.kernels.records;

  /**
   * Run one write with its busy flag and its error, the same way for every action.
   *
   * The error is kept *and* notified: the panel shows it beside the note it is about, and the toast
   * is for when the panel has been closed in the meantime.
   */
  async function guarded<T>(flag: (v: string) => void, key: string, run: () => Promise<T>, failure: string) {
    flag(key);
    setLastError('');
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : failure;
      setLastError(message);
      deps.notify?.('error', message);
      return undefined;
    } finally {
      flag('');
    }
  }

  /** Save a new note. Resolves the note's id, or empty if there was nowhere to write it. */
  async function create(document: ComposedDocument): Promise<string> {
    const data = personal();
    if (!data?.ready()) {
      setLastError('Your personal space is not ready yet.');
      return '';
    }
    const written = await guarded(
      setSaving,
      'new',
      () => data.documents.create(document, { kind: NOTE_KIND }),
      'Could not save the note.',
    );
    return written?.id ?? '';
  }

  /** Save an edit to a note. */
  async function update(id: string, document: ComposedDocument): Promise<void> {
    const data = personal();
    if (!id || !data?.ready()) return;
    await guarded(setSaving, id, () => data.documents.update(id, document), 'Could not save the note.');
  }

  /**
   * Delete a note, and the record of where it was shared.
   *
   * The posts it became are untouched. They were copies, in spaces other people read, and a note
   * being tidied away is no reason for a conversation to lose a post.
   */
  async function remove(id: string): Promise<void> {
    const data = personal();
    if (!id || !data?.ready()) return;
    await guarded(
      setSaving,
      id,
      async () => {
        await data.documents.remove(id);
        const shares = (await data.find('NoteShare', { where: { noteId: id } })) as unknown as ShareRow[];
        for (const share of shares) await data.remove('NoteShare', share.id);
      },
      'Could not delete the note.',
    );
  }

  /**
   * Copy a note into the space on screen as a post, and remember where it went.
   *
   * ## A copy, never a reference
   *
   * A post that pointed at the note would render empty for everyone but its author: nobody else can
   * read a personal space. So the composition is read out with its files as payloads, and written
   * into the space, which uploads them again to storage the space's members can reach.
   *
   * ## Independent afterwards
   *
   * Editing the note does not change the post, and the post can be edited by its space like any
   * other. Sharing is publishing: what was said is what was said. Pushing a later edit is a separate,
   * deliberate act this store does not offer yet.
   *
   * `spaceName` is handed in rather than looked up — the panel has it, and a kernel that named spaces
   * would be one more thing a module could enumerate.
   */
  async function share(id: string, spaceName = ''): Promise<string> {
    const data = personal();
    const records = space();
    if (!id || !data?.ready() || !records) return '';
    const post = await guarded(
      setSharing,
      id,
      async () => {
        const document = await data.documents.read(id);
        if (!document) throw new Error('That note could not be read.');
        const written = await records.documents.create(document, { kind: NOTE_KIND });
        if (!written) throw new Error('Open a space to share this note into.');
        await data.create('NoteShare', {
          noteId: id,
          ref: written.ref,
          spaceName,
          sharedAt: new Date().toISOString(),
        });
        return written;
      },
      'Could not share the note.',
    );
    if (post) deps.notify?.('success', spaceName ? `Shared in ${spaceName}` : 'Shared');
    return post?.id ?? '';
  }

  /*
    A note dragged into a space is shared as surely as one shared with the button, and should say so
    on its card. The host writes the post — every drop target does it the same way — and announces
    it; this writes it down when what arrived was one of this agent's notes.

    A copy only: the personal space holds nothing but the agent's own things, so a note is always
    copied, never quoted.
  */
  const stopListening = deps.kernels.records?.onCopiedIn((event) => {
    const data = personal();
    if (event.mode !== 'copy' || !data?.ready()) return;
    const from = parseRef(event.from);
    if (!from || from.entity !== 'CollectionBlock' || from.datasetKey !== data.refKey()) return;
    void data
      .create('NoteShare', {
        noteId: from.id,
        ref: event.to,
        spaceName: event.spaceName,
        sharedAt: new Date().toISOString(),
      })
      .catch((error: unknown) => console.error('notes: could not record where a note was shared', error));
  });
  if (stopListening) deps.onDispose?.(stopListening);

  return {
    saving,
    sharing,
    lastError,
    create,
    update,
    remove,
    share,
  };
}
