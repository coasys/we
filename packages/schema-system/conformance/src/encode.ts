/**
 * JSON encoding for the values vectors carry.
 *
 * Vector files are plain JSON, but the values an expression or a function can read or produce are
 * not all JSON: `undefined`, `NaN`, non-finite numbers, functions and store namespaces need a
 * spelled-out form. Each gets a single-key marker object, so an encoded value is still the shape it
 * decodes to — a list is a list, a record a record — and a loader that does not know the markers
 * fails loudly rather than misreading.
 *
 * The markers — a key no template value may legitimately carry:
 *
 * | encoded                    | decoded                                              |
 * |----------------------------|------------------------------------------------------|
 * | `{"$undefined": true}`     | `undefined`                                          |
 * | `{"$nan": true}`           | `NaN`                                                |
 * | `{"$number": "Infinity"}`  | `Infinity` (`"-Infinity"` for the negative)          |
 * | `{"$number": "-0"}`        | `-0` — JSON prints it `0`, but `1/-0` is `-Infinity` |
 * | `{"$callable": "<name>"}`  | a function (the name is informative; decoding stubs) |
 * | `{"$namespace": {...}}`    | `namespace(prop => members[prop])`                    |
 * | `{"$namespace": true}`     | an opaque namespace (used only in output position)   |
 *
 * Object key order is authored order: `JSON.parse` preserves it and `encode` iterates
 * `Object.entries`, so a round trip neither sorts nor reorders. `null`, `Infinity` and friends are
 * deliberately not folded into each other — `null` is a value, `undefined` is an absence, and the
 * where-language treats them differently.
 */
import { NAMESPACE, namespace } from '../../shared/src/index.ts';

export type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const isNamespace = (v: unknown): v is { get: (p: string) => unknown } =>
  typeof v === 'object' && v !== null && NAMESPACE in v;

/** Encode any value the evaluator can hold or produce. Throws on a value with no encoding. */
export function encodeValue(value: unknown): EncodedValue {
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $nan: true };
    if (Object.is(value, -0)) return { $number: '-0' };
    if (!Number.isFinite(value)) return { $number: value > 0 ? 'Infinity' : '-Infinity' };
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'function') return { $callable: (value as { name?: string }).name || 'anonymous' };
  if (isNamespace(value)) {
    // A namespace's `get` cannot be enumerated — in output position it is recorded as opaque.
    const members = Object.fromEntries(
      Object.entries(value as object)
        .filter(([k]) => k !== 'get')
        .map(([k, v]) => [k, encodeValue(v)]),
    );
    return { $namespace: Object.keys(members).length ? members : true };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === 'object') {
    const out: Record<string, EncodedValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v);
    return out;
  }
  if (typeof value === 'bigint') return { $number: String(value) };
  if (typeof value === 'symbol') return { $callable: String(value) };
  throw new Error(`encodeValue: no encoding for ${typeof value}`);
}

/** Decode an encoded value back into what the recorder gave the evaluator. */
export function decodeValue(value: EncodedValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  // A form-meta entry (`error`/`valid`/`touched`/`formValid` read these): `{touched, errors}`
  // becomes the `{touched(), errors()}` accessor shape LocalMetaMap entries carry.
  if (has(value, '$localMetaEntry')) {
    const entry = value as { touched: boolean; errors: EncodedValue[] };
    return { touched: () => entry.touched, errors: () => entry.errors.map(decodeValue) };
  }
  const keys = Object.keys(value);
  if (keys.length === 1) {
    if (has(value, '$undefined')) return undefined;
    if (has(value, '$nan')) return NaN;
    if (has(value, '$number')) {
      const t = (value as { $number: string }).$number;
      if (t === 'Infinity') return Infinity;
      if (t === '-Infinity') return -Infinity;
      return Number(t);
    }
    if (has(value, '$callable')) {
      // A function the evaluator may read but never call — readValue refuses or unwraps by tag.
      const stub = () => undefined;
      Object.defineProperty(stub, 'name', { value: (value as { $callable: string }).$callable });
      return stub;
    }
    if (has(value, '$namespace')) {
      const members = (value as { $namespace: unknown }).$namespace;
      if (members === true) return namespace(() => undefined);
      const decoded = decodeValue(members as EncodedValue) as Record<string, unknown>;
      return namespace((prop) => decoded[prop]);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = decodeValue(v);
  return out;
}
