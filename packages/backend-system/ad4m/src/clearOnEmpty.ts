/**
 * Make `''` mean "clear this property", which is what every caller in WE already assumed.
 *
 * ## The bug
 *
 * `Ad4mModel.planProperty` plans no write for `undefined | null | ''`, with the comment "Skip storing
 * empty/null/undefined values to avoid invalid empty literals". That is right about the literal —
 * `literal:string:` is not a value — and wrong about what to do next: skipping the write leaves the
 * *old* value in the perspective, so a property can be set and can never be unset.
 *
 * Nothing said so, and by the fourth audit four separate places were relying on it working:
 *
 * - **The content layer.** Turning a bullet back into a paragraph writes `listItem: ''`; removing
 *   the last bold mark writes `marks: ''`; emptying a paragraph writes `text: ''`. Each was a
 *   no-op, so the derived blob was correct and the `TextBlock` model — which the content layer
 *   calls canonical, and which search, extraction, `$query` and the graph all read — kept the old
 *   content. Every clear-to-empty edit inverted the layer's own premise.
 * - **`themeStore.setSystemTheme(polarity, '')`**, documented as the way to return one side of
 *   Follow-system to the built-in. The reseed effect restored the old id on the next load.
 * - **`editorStore.setApiKey('')`**: the Claude key could not be removed from the perspective.
 * - **The in-memory backend does clear on `''`**, so every store test that exercised one of these
 *   passed while the AD4M path silently did nothing. The suite that doubles as a conformance test
 *   was blind to the exact bug class it exists to catch.
 *
 * ## The fix, and why it is here
 *
 * Clearing a property means removing its links, which is a perspective operation and not something
 * the SDK's write planning was ever going to reach by adjusting a literal. So this wraps
 * `innerUpdate` — which is what `save()` and the static `update()` both run, and which plans each
 * field's writes through `updateWrites`/`planProperty`, where `''` is skipped.
 *
 * ## Why the seam is `innerUpdate`, and how it is tested
 *
 * An earlier version wrapped `setProperty`. It was correct, tested, and never once reached on the
 * path every caller in WE actually uses — `innerUpdate` filtered `''` out before `setProperty` was
 * called, and at the pinned SDK nothing internal calls `setProperty` at all. Its tests called
 * `setProperty` directly on a stand-in, which says nothing about whether anything calls it. That
 * is the general hazard with patching somebody else's prototype: the seam is only where you think
 * it is until the version underneath moves it, and nothing in this repo compiles against its
 * internals. So `clearOnEmpty.sdk.test.ts` drives `save()` and the static `update()` on the real
 * SDK class, and fails the day the seam moves again.
 *
 * Before the original runs, every **dirty property** whose value is now `''` has its links
 * removed; the original then skips those fields exactly as it did, so nothing is written twice
 * and no behaviour but the clearing changes. Relations are left alone —
 * an empty string is not a relation value, and `setRelationValues([])` is already how a relation is
 * emptied — as are flag and read-only properties, which are immutable after creation.
 *
 * In the AD4M adapter rather than upstream because it is WE's contract being repaired, not AD4M's —
 * and in one prototype patch rather than in a base class because the model classes are generated
 * from the manifest and extend `Ad4mModel` directly. One place, one reason, applied to every model
 * the adapter registers.
 *
 * ## Two things it deliberately does not do
 *
 * **`null` and `undefined` still skip.** Only `''` clears. A model instance carries `undefined` for
 * anything not loaded and for every optional field a caller never touched, so treating those as a
 * clear would turn an ordinary partial save into data loss. `''` is the spelling WE uses when it
 * means empty, and it is the only one given that meaning here.
 *
 * **A record with no snapshot skips too.** No snapshot means the instance has never been fetched —
 * it is being created — and there is nothing stored to remove. Without this, creating a record
 * would issue a link query and a removal for every empty string field on it, since `innerUpdate`
 * has no dirty set to narrow by on the create path. With it, the cost is exactly one query and one
 * removal, and only for a field that genuinely changed to empty.
 */
import type { Ad4mModel } from '@coasys/ad4m';

/** The private shape `Ad4mModel` actually has. Underscored fields, not a public API — see below. */
interface ModelInternals {
  _perspective?: {
    get: (query: { source?: string; predicate?: string }) => Promise<unknown[]>;
    removeLinks: (links: unknown[], batchId?: string) => Promise<unknown>;
  };
  _baseExpression?: string;
  _snapshot?: unknown;
  getPropertyMetadata?: (key: string) => { through?: string; flag?: unknown; readOnly?: unknown } | undefined;
  /** The fields that differ from the snapshot taken at the last hydration. Properties and relations. */
  changedFields?: () => string[];
}

type InnerUpdate = (this: unknown, setProperties?: boolean, batchId?: string) => Promise<void>;

/** Marker so a second call is a no-op — the adapter can be initialised more than once per process. */
const PATCHED = Symbol.for('we.ad4m.clearOnEmpty');

/**
 * Remove every link carrying this property's predicate, so the property reads as absent.
 *
 * Best-effort: a failure is logged and swallowed rather than thrown, because the alternative is a
 * `save()` that throws where it used to silently do nothing — turning a data-integrity bug into an
 * availability one, in a path (composing a post) where the rest of the save is fine.
 */
async function clearProperty(model: ModelInternals, key: string): Promise<void> {
  const predicate = model.getPropertyMetadata?.(key)?.through;
  const source = model._baseExpression;
  const perspective = model._perspective;
  if (!predicate || !source || !perspective) return;

  try {
    const links = await perspective.get({ source, predicate });
    if (links.length) await perspective.removeLinks(links);
  } catch (error) {
    console.warn(`ad4m: could not clear "${key}"`, error);
  }
}

/**
 * Install the patch on `Ad4mModel.prototype`. Idempotent.
 *
 * Called once when the adapter builds its ports, so every model class — generated, compiled from a
 * manifest, or built from foreign SHACL — inherits it, including classes that do not exist yet.
 */
/**
 * The properties a save is about to skip because they have been emptied.
 *
 * Dirty, so an untouched optional field that has always been empty costs nothing; a *property*
 * rather than a relation, since an empty string is not a relation value; and neither a flag nor a
 * read-only field, which `innerUpdate` refuses to write for reasons that apply equally to clearing.
 */
function emptiedProperties(model: ModelInternals): string[] {
  const fields = model.changedFields?.() ?? [];
  return fields.filter((key) => {
    if ((model as unknown as Record<string, unknown>)[key] !== '') return false;
    const meta = model.getPropertyMetadata?.(key);
    return !!meta?.through && !meta.flag && !meta.readOnly;
  });
}

export function installClearOnEmpty(model: typeof Ad4mModel): void {
  const prototype = model.prototype as unknown as Record<string | symbol, unknown>;
  if (prototype[PATCHED]) return;

  /*
    The SDK filters `''` out while planning the writes, so the clearing has to happen beside that
    filter rather than behind it.

    Before the original rather than after: the original writes the fields that *do* have values, and
    a clear that ran afterwards would be racing a write it cannot see. Nothing is written twice —
    the original still skips every field cleared here.
  */
  const originalInnerUpdate = prototype.innerUpdate as InnerUpdate;
  if (typeof originalInnerUpdate !== 'function') return;

  prototype.innerUpdate = async function patched(this: ModelInternals, setProperties = true, batchId?: string) {
    // `setProperties: false` is the create path, where `create_subject` writes the values map and
    // there is nothing stored to remove — the same reason a record with no snapshot skips.
    if (setProperties && this._snapshot) {
      for (const key of emptiedProperties(this)) await clearProperty(this, key);
    }
    return originalInnerUpdate.call(this, setProperties, batchId);
  };

  prototype[PATCHED] = true;
}
