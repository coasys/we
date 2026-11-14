/**
 * The sync rules for `$localState` fields — `persist` (a device-storage entry) and `syncParam`
 * (a URL query parameter), which decide a field's mount-time initial and what a write to it
 * mirrors outward.
 *
 * Pure data, no framework: the renderer feeds its own `localStorage` and the host's
 * `$routeParams` binding, and anything else that must agree — a second renderer, the
 * conformance recorder — feeds its own. One implementation, so the three cannot drift: these
 * rules are part of the template contract, not of Solid.
 */
import type { LocalStateField, RouteParamsBinding } from './types';

/** The param a `syncParam` declaration mirrors into, with its history policy resolved. */
export interface LocalSyncSpec {
  name: string;
  push: boolean;
}

/**
 * The localStorage key a field persists under — `we-local:<persist>` — or `null` when the field
 * opted out, its type has no JSON form, or this environment has no storage at all.
 */
export function localPersistKey(field: Pick<LocalStateField, 'type' | 'persist'>): string | null {
  return typeof field.persist === 'string' &&
    field.type !== 'file' &&
    field.type !== 'function' &&
    typeof localStorage !== 'undefined'
    ? `we-local:${field.persist}`
    : null;
}

/**
 * `{name, push}` when the field mirrors into the URL, `null` when it declared no `syncParam` or
 * its type has no URL form. A bare string is the no-history form — `push: false`.
 */
export function localSyncSpec(field: Pick<LocalStateField, 'type' | 'syncParam'>): LocalSyncSpec | null {
  if (!field.syncParam || field.type === 'file' || field.type === 'function') return null;
  return typeof field.syncParam === 'string'
    ? { name: field.syncParam, push: false }
    : { name: field.syncParam.name, push: field.syncParam.push ?? false };
}

/**
 * A param's text back into a field value: `string` fields keep the raw text, everything else is
 * `JSON.parse` — with the raw text as the answer when it does not parse.
 */
export function decodeLocalParam(type: LocalStateField['type'], raw: string): unknown {
  if (type === 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** A field value into param text: `string` fields write raw, everything else is JSON. */
export function encodeLocalParam(type: LocalStateField['type'], value: unknown): string {
  return type === 'string' ? String(value) : JSON.stringify(value);
}

/**
 * The text a write puts in the param — `null`, which clears it, when the value is back at the
 * declared initial (JSON-compared), so a URL holds only what differs from the template's default.
 */
export function localParamText(type: LocalStateField['type'], value: unknown, declaredInitial: unknown): string | null {
  return JSON.stringify(value) === JSON.stringify(declaredInitial) ? null : encodeLocalParam(type, value);
}

/** What a write to the field mirrors outward: the storage entry, and the URL-param write. */
export interface LocalWriteMirror {
  /** `localStorage.setItem(key, json)` — always JSON, whatever the field's type. */
  store?: { key: string; json: string };
  /** `routeParams.set(name, text, {push})` — `text` is `null` when the write returns to initial. */
  param?: { name: string; text: string | null; push: boolean };
}

export function localWriteMirror(
  field: Pick<LocalStateField, 'type' | 'persist' | 'syncParam'>,
  value: unknown,
  declaredInitial: unknown,
): LocalWriteMirror {
  const mirror: LocalWriteMirror = {};
  const key = localPersistKey(field);
  if (key) mirror.store = { key, json: JSON.stringify(value) };
  const spec = localSyncSpec(field);
  if (spec) {
    mirror.param = { name: spec.name, text: localParamText(field.type, value, declaredInitial), push: spec.push };
  }
  return mirror;
}

/**
 * The mount-time initial: the declared `initial` (already evaluated — expressions resolved),
 * overridden by the persisted entry, overridden by the URL param.
 */
export function resolveLocalInitial(
  field: Pick<LocalStateField, 'type' | 'persist' | 'syncParam'>,
  initial: unknown,
  bindings: {
    routeParams?: Pick<RouteParamsBinding, 'get'>;
    storage?: Pick<Storage, 'getItem'>;
  } = {},
): unknown {
  let value = initial;
  const key = localPersistKey(field);
  if (key && bindings.storage) {
    try {
      const storedRaw = bindings.storage.getItem(key);
      if (storedRaw !== null) value = JSON.parse(storedRaw);
    } catch {
      // A corrupt entry — the declared initial stands.
    }
  }
  const spec = localSyncSpec(field);
  if (spec && bindings.routeParams) {
    const fromUrl = bindings.routeParams.get(spec.name);
    if (fromUrl !== undefined) value = decodeLocalParam(field.type, fromUrl);
  }
  return value;
}
