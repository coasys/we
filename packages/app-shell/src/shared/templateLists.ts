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
