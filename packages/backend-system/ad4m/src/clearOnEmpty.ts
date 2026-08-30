/**
 * Make `''` mean "clear this property", which is what every caller in WE already assumed.
 *
 * ## The bug
 *
 * `Ad4mModel.setProperty` returns early for `undefined | null | ''`, with the comment "Skip storing
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
 * `setProperty` was ever going to reach by adjusting a literal. So this wraps it: `''` removes the
 * links carrying that property's predicate, and everything else is passed through untouched.
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
}

type SetProperty = (this: unknown, key: string, value: unknown, batchId?: string) => Promise<void>;

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
export function installClearOnEmpty(model: typeof Ad4mModel): void {
  const prototype = model.prototype as unknown as Record<string | symbol, unknown>;
  if (prototype[PATCHED]) return;

  const original = prototype.setProperty as SetProperty;
  if (typeof original !== 'function') return;

  prototype.setProperty = async function patched(this: ModelInternals, key: string, value: unknown, batchId?: string) {
    if (value === '') {
      // Nothing stored yet — see the docblock on why a create must not pay for this.
      if (this._snapshot) await clearProperty(this, key);
      return;
    }
    return original.call(this, key, value, batchId);
  } as SetProperty;

  prototype[PATCHED] = true;
}
