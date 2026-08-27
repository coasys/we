export function asVoid<T extends unknown[]>(fn: (...args: T) => unknown): (...args: T) => void {
  // Wraps a function to ensure it returns void
  // Useful for SolidJS setters that expect a void return type
  return (...args: T) => {
    fn(...args);
    return;
  };
}

export function clone<T>(value: T): T {
  // Shallowly clones an object or array
  // Useful for ensuring reactivity in SolidJS setter by creating new references
  if (Array.isArray(value)) {
    // Clone each item in the array (shallow clone for objects)
    return value.map((item) => (typeof item === 'object' && item !== null ? { ...item } : item)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return { ...value };
  }
  return value;
}

/**
 * Deep clone, via JSON round-trip.
 *
 * `structuredClone` was tried here and reverted, and the reason is worth stating rather than leaving
 * as a commented-out line: callers clone Solid stores, which are proxies, and `structuredClone`
 * throws `DataCloneError` on a proxy. The caller then aborts and the mutation silently does not
 * happen. See `@we/editor`'s copy, which reintroduced the same bug and produced exactly that symptom.
 */
export function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Put text on the clipboard, by whichever route this page has.
 *
 * The async clipboard API is **secure-context only**, so `navigator.clipboard` is simply absent on
 * a deployment served over plain HTTP at a LAN address — which is how WE is demonstrated, and the
 * one place a guest link can be generated at all. Every copy control in the app reported "Could not
 * copy the link" there, having caught a `TypeError` on `undefined.writeText` and reported it as a
 * clipboard failure. Same class of gap as `crypto.randomUUID`, and it fails the same way: invisibly
 * in development on localhost, which *is* a secure context.
 *
 * The fallback is a hidden textarea and `document.execCommand('copy')` — deprecated, universally
 * supported, and the only thing available outside a secure context. It must run inside the user
 * gesture that asked for it, which is where every caller already is.
 *
 * `@we/editor`'s `CodeViewer` had already solved this privately and keeps its own copy: the editor
 * does not depend on `@we/app-shell` and should not start, since dependencies point inward toward
 * the contract packages. The duplication is deliberate rather than missed — if a third consumer
 * appears outside the shell, this belongs in a package both can reach.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // A refused permission or a document that is not focused. The legacy path can still work, so
    // this falls through rather than reporting a failure the user could do nothing about.
  }
  return copyViaSelection(text);
}

function copyViaSelection(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Off-screen rather than hidden: the copy *is* a selection, and neither `display: none` nor
  // `visibility: hidden` can be selected.
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    // Selecting moved focus off whatever was pressed; put it back so the keyboard is not stranded.
    previous?.focus();
  }
}
