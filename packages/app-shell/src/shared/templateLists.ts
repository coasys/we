import type { TemplateSchema } from '@we/schema-shared';

/**
 * The template list once the agent's library has been read: the library, and every space template
 * already loaded, kept.
 *
 * The two arrive separately and in no fixed order. A space's templates are read when the space opens,
 * the library when the root dataset is ready, and on a reload into a space the library usually lands
 * second — and replacing the whole list then dropped the space's templates with nothing to say so. A
 * space whose sections were copies drew none of them, and its own shell template fell back. Only
 * `clearSpaceTemplates` decides the space's templates are gone.
 */
export function withLibrary(previous: readonly TemplateSchema[], library: readonly TemplateSchema[]): TemplateSchema[] {
  return [...library.filter((t) => !t._fromSpace), ...previous.filter((t) => t._fromSpace)];
}

/**
 * The listed template ids with the library's part worked out again: every library template the
 * agent has not hidden. `library` pairs each library template's id with its record's.
 *
 * The library is what is shown, minus what the agent hid — never a list of what to show. A list of
 * what to show leaves out every template written from somewhere other than this screen (another
 * device, an agent, a bundle) until somebody also adds it to the list. What else is listed (the open
 * space's templates) is left as it was, including a space template sharing an id with a hidden one.
 */
export function withLibraryListed(
  listed: ReadonlySet<string>,
  library: Iterable<[id: string, recordId: string]>,
  hidden: (recordId: string) => boolean,
  inSpace: (id: string) => boolean,
): Set<string> {
  const next = new Set(listed);
  for (const [id, recordId] of library) {
    if (!hidden(recordId)) next.add(id);
    else if (!inSpace(id)) next.delete(id);
  }
  return next;
}
