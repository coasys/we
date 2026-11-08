/**
 * The executor this phone logs in to with its device key: a URL, kept in the app's localStorage.
 *
 * Under its own key, apart from ad4m-connect's: the connect UI's choice of node is about a
 * password session, and a key login must never be confused with it, or replace it. The phone's
 * join screen (`apps/we-mobile/src/identity`) asks for it beside the offer.
 */
export const KEY_HOST_KEY = 'we-phone/key-host';

/**
 * Set when the person chose "Not now" on the phone's join screen: WE then boots to its own sign-in
 * rather than sending them back to join. {@link forgetJoinDeclined} asks again.
 */
export const JOIN_DECLINED_KEY = 'we-phone/join-declined';

/** Whether the person said "Not now" to joining with this phone's device key. */
export function joinDeclined(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): boolean {
  try {
    return !!storage?.getItem(JOIN_DECLINED_KEY);
  } catch {
    return false;
  }
}

/** Lets the next boot offer joining again. */
export function forgetJoinDeclined(storage: Pick<Storage, 'removeItem'> | undefined = safeLocalStorage()): void {
  try {
    storage?.removeItem(JOIN_DECLINED_KEY);
  } catch {
    // No storage: nothing was kept.
  }
}

/** The URL, when one is set and is http(s). */
export function readKeyHost(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): string | null {
  let value: string | null = null;
  try {
    value = storage?.getItem(KEY_HOST_KEY) ?? null;
  } catch {
    return null;
  }
  return value && isHttpUrl(value) ? value.replace(/\/+$/, '') : null;
}

/** Remembers `url` as the executor to log in to; `null` forgets it. */
export function rememberKeyHost(
  url: string | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeLocalStorage(),
): void {
  if (!storage) return;
  if (url === null) {
    storage.removeItem(KEY_HOST_KEY);
    return;
  }
  if (!isHttpUrl(url)) throw new Error('the executor URL is http(s)');
  storage.setItem(KEY_HOST_KEY, url.replace(/\/+$/, ''));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
