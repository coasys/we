/**
 * `json` properties as values on AD4M: written as an array or an object, read back as one.
 *
 * The contract says a `json` property is a structured value and its serialisation is the
 * backend's business (`WriteValue` in `@we/backend-shared`). The executor already has the
 * encoding: a `literal:json:` target, which it parses when it hydrates a row, so a stored list
 * reads back as a list with nothing done here. What the model layer lacks is the write side.
 * `Ad4mModel` treats every array it is handed as a relation's members, so a list written to a
 * property would be planned as link writes on a relation that does not exist; and it compares an
 * array property against its snapshot as an unordered set, so reordering a list would not count
 * as a change at all.
 *
 * So for the length of a `save()` each `json` property holding a value is swapped for its
 * `literal:json:` IRI — a string, which both the create and the edit path store as it is — and put
 * back afterwards. A changed list is then a changed string, whatever its order. The snapshot keeps
 * a copy of the value and is compared by its JSON, so a list changed in place still saves.
 *
 * On a read, a `json` property that comes back as text — a value written before the property was
 * `json`, or a `literal:json:` target the executor could not parse — is parsed here. Text that does
 * not parse is reported once per property and read as absent, never thrown: one bad value must not
 * take the record it is on out of every list that reads it.
 *
 * Which properties are `json` is not in the decorator metadata, so it is registered by class name:
 * the core vocabulary from its manifest when the patch is installed, and a module's entities when
 * `compileManifest` builds them.
 */
import { type Ad4mModel, Literal } from '@coasys/ad4m';
import { type EntityManifest, type EntitySchema, readJsonValue, writtenJsonValue } from '@we/backend-shared';

const PATCHED = Symbol.for('we.ad4m.jsonValues');
/** Set while an instance's own `save()` runs, so the swapped-in IRIs are not read as stored text. */
const SAVING = Symbol.for('we.ad4m.jsonValues.saving');

const jsonFields = new Map<string, ReadonlySet<string>>();

/**
 * Record which properties of each entity in `manifest` are `json`, inheritance included. A parent
 * the manifest does not declare is looked up in `parents`.
 */
export function registerJsonFields(manifest: EntityManifest, parents?: EntityManifest): void {
  const resolved = (name: string): EntitySchema | undefined => {
    const entity = manifest.entities[name] ?? parents?.entities[name];
    if (!entity) return undefined;
    const parent = entity.extends ? resolved(entity.extends) : undefined;
    return parent ? { ...entity, properties: { ...parent.properties, ...entity.properties } } : entity;
  };
  for (const name of Object.keys(manifest.entities)) {
    const props = Object.entries(resolved(name)?.properties ?? {})
      .filter(([, spec]) => spec.type === 'json')
      .map(([prop]) => prop);
    if (props.length) jsonFields.set(name, new Set(props));
    else jsonFields.delete(name);
  }
}

interface Instance {
  _snapshot?: Record<string, unknown> | null;
  [SAVING]?: boolean;
  [field: string]: unknown;
  constructor: { getModelMetadata?: () => { className?: string } };
}

function fieldsOf(instance: Instance): ReadonlySet<string> | undefined {
  const name = instance.constructor.getModelMetadata?.().className;
  return name ? jsonFields.get(name) : undefined;
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === '';

const labelOf = (instance: Instance, field: string) =>
  `${instance.constructor.getModelMetadata?.().className ?? 'entity'}.${field}`;

/** The value a property's text stands for: its IRI while a save is under way, or JSON. */
function valueOf(instance: Instance, field: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.startsWith('literal:')) {
    try {
      return Literal.fromUrl(value).get() as unknown;
    } catch {
      return undefined;
    }
  }
  return readJsonValue(labelOf(instance, field), value);
}

/** A copy for the snapshot, so a value changed in place still differs from it. */
function copyOf(instance: Instance, field: string, value: unknown): unknown {
  const decoded = valueOf(instance, field, value);
  return decoded !== null && typeof decoded === 'object' ? (JSON.parse(JSON.stringify(decoded)) as unknown) : decoded;
}

function sameValue(instance: Instance, field: string, a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  return JSON.stringify(valueOf(instance, field, a)) === JSON.stringify(valueOf(instance, field, b));
}

type Method = (this: Instance, ...args: unknown[]) => unknown;

/** Install on `Ad4mModel.prototype`, before the write checks so they see values. Idempotent. */
export function installJsonValues(model: typeof Ad4mModel, core: EntityManifest): void {
  registerJsonFields(core);
  const prototype = model.prototype as unknown as Record<string | symbol, unknown>;
  if (prototype[PATCHED]) return;

  const takeSnapshot = prototype.takeSnapshot as Method | undefined;
  const changedFields = prototype.changedFields as Method | undefined;
  const save = prototype.save as Method | undefined;
  if (typeof takeSnapshot !== 'function' || typeof changedFields !== 'function' || typeof save !== 'function') return;

  // Every hydrated instance is snapshotted — a read, a live push, an included record, a save's
  // re-read — which makes this the one place a read passes through after its values have landed.
  prototype.takeSnapshot = function withJsonValues(this: Instance, ...args: unknown[]) {
    const fields = fieldsOf(this);
    if (fields && !this[SAVING]) {
      for (const field of fields) {
        if (typeof this[field] === 'string') this[field] = valueOf(this, field, this[field]);
      }
    }
    const result = takeSnapshot.apply(this, args);
    if (fields && this._snapshot) {
      for (const field of fields) {
        if (field in this._snapshot) this._snapshot[field] = copyOf(this, field, this[field]);
      }
    }
    return result;
  };

  prototype.changedFields = function withJsonValues(this: Instance, ...args: unknown[]) {
    const changed = changedFields.apply(this, args) as string[];
    const fields = fieldsOf(this);
    if (!fields || !this._snapshot) return changed;
    const out = changed.filter((field) => !fields.has(field));
    for (const field of fields) {
      if (field in this._snapshot && !sameValue(this, field, this[field], this._snapshot[field])) out.push(field);
    }
    return out;
  };

  prototype.save = async function withJsonValues(this: Instance, ...args: unknown[]) {
    const fields = fieldsOf(this);
    if (!fields || this[SAVING]) return save.apply(this, args);
    const swapped = new Map<string, { value: unknown; iri: string }>();
    for (const field of fields) {
      const value = writtenJsonValue(labelOf(this, field), this[field]);
      if (value === undefined) {
        // Text that says `null` clears the property, as `null` itself does.
        if (!isEmpty(this[field])) this[field] = null;
        continue;
      }
      const iri = Literal.from(value).toUrl();
      swapped.set(field, { value, iri });
      this[field] = iri;
    }
    this[SAVING] = true;
    try {
      return await save.apply(this, args);
    } finally {
      this[SAVING] = false;
      for (const [field, { value, iri }] of swapped) {
        // A save that read the record back has the stored value there already.
        if (this[field] === iri) this[field] = value;
        if (this._snapshot && this._snapshot[field] === iri) this._snapshot[field] = copyOf(this, field, value);
      }
    }
  };

  prototype[PATCHED] = true;
}
