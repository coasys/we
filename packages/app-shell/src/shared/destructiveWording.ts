/**
 * The words the host puts in front of a destructive action a template asked for.
 *
 * In `shared/` rather than beside the dialog that renders it, and not because of its size: it is a
 * pure function from a store path and its arguments to two sentences, with no reactivity, no store
 * and no DOM. Keeping it here makes it testable without mounting the shell — and the thing worth
 * testing is precisely that the sentences are *true of the request*, since a dialog saying "this
 * record" about seven of them is the guard misreporting the thing somebody is about to answer.
 */

/**
 * What the host says when a template asks to delete something.
 *
 * Written from the path and the arguments, and deliberately in the host's own words rather than the
 * template's: the template is the thing being guarded against, so a dialog it could phrase is a
 * dialog it could phrase misleadingly. The same wording every time is also what makes it
 * recognisable — a person learns what WE's delete confirmation looks like, and nothing rendered
 * inside a space can imitate it.
 *
 * Fallback rather than exhaustive on purpose. A member marked `destructive` that nobody has written
 * a sentence for still gets a dialog naming the action, which is the direction to fail in: adding a
 * destructive member and forgetting this file costs a vague prompt, not a missing one.
 */
export function describeDestructive(path: string, args: unknown[]): { title: string; body: string } {
  const entity = typeof args[0] === 'string' ? args[0] : '';
  switch (path) {
    case 'record.delete':
      return {
        title: entity ? `Delete this ${entity}?` : 'Delete this record?',
        body: 'It will be removed for everyone in this space. This cannot be undone.',
      };
    case 'recordStore.deleteRecords': {
      /*
        The number is the point of this case existing.

        A person about to answer "delete these?" over a rubber-band selection cannot count what is
        inside a dashed rectangle on a dense canvas, and the difference between three and thirty is
        the difference between yes and no. The count comes from the argument rather than from
        anything the template said, so it is true however the template phrased the press.
      */
      const rows = Array.isArray(args[0]) ? (args[0] as { recordType?: string }[]) : [];
      const count = rows.length;
      /*
        Named where the set agrees on what it is, which is the ordinary case — a sweep over a canvas
        usually catches one kind of thing. "Delete 7 TaskBlocks?" tells somebody what they are about
        to lose where "Delete 7 records?" only tells them how much.
      */
      const kinds = new Set(rows.map((row) => row.recordType).filter(Boolean));
      const kind = kinds.size === 1 ? [...kinds][0] : '';
      return {
        title:
          count === 1
            ? kind
              ? `Delete this ${kind}?`
              : 'Delete this record?'
            : `Delete ${count} ${kind ? `${kind}s` : 'records'}?`,
        body:
          count === 1
            ? 'It will be removed for everyone in this space. This cannot be undone.'
            : 'They will be removed for everyone in this space. This cannot be undone.',
      };
    }
    case 'spaceStore.deleteCollection':
      // Deliberately not "the post". A collection is kind-agnostic — a post, a recorded call and a
      // notes collection are the same shape and the same recursive delete — so naming one of them
      // asks the wrong question about the other two, and the transcript a call is about to lose
      // does not read as "a block".
      return {
        title: 'Delete this and everything in it?',
        body: 'Everything inside it will be removed for everyone in this space. This cannot be undone.',
      };
    case 'shapeStore.deleteShape':
      return {
        title: 'Delete this model?',
        body: 'Records already created keep their data — only the definition goes, and nothing can be created from it afterwards.',
      };
    default:
      return {
        title: 'Delete this?',
        body: 'This cannot be undone.',
      };
  }
}
