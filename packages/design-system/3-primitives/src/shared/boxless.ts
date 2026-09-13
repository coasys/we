/**
 * The one thing a boxless wrapper cannot do, said out loud.
 *
 * `we-draggable` and `we-tooltip` are `display: contents`: they decorate a child with behaviour and
 * must not take part in their parent's layout, or they steal the grid track the child should have
 * had, become the flex item the child should have been, and absorb stretch alignment. That decision
 * is argued on each of them.
 *
 * The cost is that a `display: contents` element generates no box at all, so every geometry prop on
 * it resolves to nothing. Not "to a default" — to nothing: the declaration is written, the property
 * applies to a box that was never generated, and the element renders exactly as it would have
 * without it. Which is the silent failure this codebase keeps hunting: it validates, it typechecks,
 * it renders, and it does not work.
 *
 * It is also an easy mistake to make honestly. Before `we-tooltip` was boxless, the wrapper *was*
 * the flex item, so the sidebar header put its width and flex on the tooltip — correctly, at the
 * time. Anything written in that period is now inert, and nothing else would ever have said so.
 *
 * A warning rather than a fix: the right answer is to move the prop to the child, and only the
 * author knows which child. Dev-only, once per element, in the shape `warnAboutSmil` established.
 */

/**
 * Props that need a box to mean anything.
 *
 * Geometry and painting, not behaviour: `onClick` and `cursor` are fine on a boxless host, since
 * the events come from the child either way. Kept explicit rather than derived from the DS layer
 * lists, because the question here is "does this need a box", which is not what a layer answers —
 * `overflow` is a layout prop and equally inert, while `pointerEvents` is a layout prop that still
 * works through the child.
 */
const NEEDS_A_BOX = [
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'flex',
  'flexShrink',
  'alignSelf',
  'overflow',
  'overflowX',
  'overflowY',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'bg',
  'border',
  'r',
  'shadow',
] as const;

/**
 * Report geometry props written on an element that generates no box.
 *
 * Call from `firstUpdated` on any `display: contents` host. Returns the offending prop names, so a
 * test can assert on the judgement without going through the console.
 */
export function boxlessLayoutProps(el: Record<string, unknown>): string[] {
  return NEEDS_A_BOX.filter((name) => {
    const value = el[name];
    return value !== undefined && value !== null && value !== '' && value !== false;
  });
}

/**
 * True in a development build — what every dev-only diagnostic in this package gates on.
 *
 * Cast rather than `vite/client` types, the same decision `@we/module-call` records in
 * `devPeers.ts`: a design-system package must not take a build tool as a dependency, since it is
 * loaded into hosts that use none. The cast is erased at compile time and the emitted
 * `import.meta.env?.DEV` is what a bundler sees.
 */
export const DEV_BUILD = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

/** The same, as a development-only warning naming what to do instead. */
export function warnAboutBoxlessLayoutProps(el: HTMLElement, tag: string): void {
  if (!DEV_BUILD) return;
  const offenders = boxlessLayoutProps(el as unknown as Record<string, unknown>);
  if (!offenders.length) return;
  console.warn(
    `${tag}: ${offenders.join(', ')} ${offenders.length === 1 ? 'does' : 'do'} nothing here. ` +
      `This element is display: contents so it generates no box, deliberately — it must not take ` +
      `the grid track or become the flex item in place of what it wraps. Put ${
        offenders.length === 1 ? 'it' : 'them'
      } on the child instead.`,
    el,
  );
}

/**
 * The nearest element at or under `el` that takes part in layout — what a boxless wrapper measures.
 *
 * A `display: contents` element has no rectangle: `getBoundingClientRect` on one is zero at the
 * origin, so anything positioned against it lands in the top-left corner of the screen. And what a
 * slot hands back is rarely what an author wrote, because the schema renderer wraps every node in a
 * `display: contents` div of its own. So this descends: through the light DOM first, then the shadow
 * root, which is where a boxless custom element keeps its own drawing (`we-icon` renders an `svg`).
 *
 * `we-tooltip` found this out first and kept the answer to itself; `we-popover` needs the same one,
 * so it lives here rather than twice.
 */
export function firstBoxIn(el: Element, depth = 0): HTMLElement | null {
  if (!(el instanceof HTMLElement) || depth > 4) return null;
  if (getComputedStyle(el).display !== 'contents') return el;
  for (const child of [...el.children, ...(el.shadowRoot?.children ?? [])]) {
    const found = firstBoxIn(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The first box among what a slot holds, or `fallback` when it holds none — see {@link firstBoxIn}. */
export function anchorInSlot(slot: HTMLSlotElement | null | undefined, fallback: HTMLElement): HTMLElement {
  for (const assigned of slot?.assignedElements({ flatten: true }) ?? []) {
    const box = firstBoxIn(assigned);
    if (box) return box;
  }
  // Nothing to point at — better a panel in the wrong place than a thrown getter.
  return fallback;
}
