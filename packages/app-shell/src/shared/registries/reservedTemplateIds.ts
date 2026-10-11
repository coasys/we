/**
 * The ids a stored template may not take: every template and section this build ships.
 *
 * A section is a template too, and a stored one sharing a built-in section's id is refused when the
 * space's sections are resolved — the built-in wins, as it must. Reserving only the built-in
 * *templates* left that collision open on the one path that makes it every time: copying a section
 * into a space carries the original's id, so a copy of About was saved as `about`. It was refused
 * in favour of the original, the swap in the section list was a no-op, and edits to the copy landed
 * in a template nothing showed — with only a console warning to say so.
 *
 * A module's sections are reserved for the same reason: a module's view wins over a stored one.
 */
import { moduleRegistry } from './moduleRegistry';
import { templateRegistry } from './templateRegistry';
import { viewRegistry } from './viewRegistry';

export function reservedTemplateIds(): string[] {
  return [...Object.keys(templateRegistry), ...Object.keys(viewRegistry), ...Object.keys(moduleRegistry.views())];
}
