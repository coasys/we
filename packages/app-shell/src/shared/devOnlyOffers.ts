/**
 * Which built-ins a picker offers: a developer-feature one (a showcase template or its theme) only
 * while developer tools are showing.
 *
 * The switch in Settings → Developer exists so a developer can see what a user sees, and a user of a
 * production build is offered none of these, since that build does not contain them. So with the
 * switch off the pickers list what production would. Only what is *offered*: a space already showing
 * one keeps it, since a display switch should not swap a space's interface out from under it, and
 * lookups by id or name use the whole list.
 *
 * One rule for the template and theme pickers alike, so they cannot come to disagree.
 */
export function offeredInPickers<T extends { id?: string }>(
  items: readonly T[],
  devToolsShowing: boolean,
  devOnly: ReadonlySet<string>,
): T[] {
  return devToolsShowing ? [...items] : items.filter((item) => !devOnly.has(item.id ?? ''));
}
