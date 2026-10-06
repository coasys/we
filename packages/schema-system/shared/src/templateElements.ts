/**
 * Which native elements a schema may mount, and which prop values it may hand them.
 *
 * ## The problem this exists for
 *
 * The renderer mounts any lowercase type as a native element and spreads any prop onto it. Measured in
 * real Chrome (the `security:code-in-template` browser case): a `script` node ran, an `iframe` with
 * `srcdoc` ran with access to the page, and a link whose `href` was `javascript:` ran on a click. A
 * template is supposed to be data — safe to install from a stranger because it can name things and
 * never run anything — and each of those was a stranger's code running in the app's origin, past the
 * store-bag allowlist and the gesture gate both.
 *
 * ## The rule
 *
 * An **allowlist** of elements that display things, not a denylist of known-bad ones: an element
 * nobody thought about is one nobody vetted, and HTML keeps growing. What is missing is absent, the
 * same answer the rest of the trust boundary gives — no error, nothing to probe.
 *
 * Left out on purpose: `script`, `noscript`, `style`, `link`, `meta`, `base`, `title`, `iframe`,
 * `frame`, `frameset`, `object`, `embed`, `portal`, `template`, `slot`, `svg`, `math`. Each either runs
 * something, loads something into the page, changes how the page resolves URLs, or creates a document
 * of its own. Frames remain available through `we-iframe`, which owns its own sandbox.
 *
 * Props are checked by value as well as by name, because an expression can produce `javascript:` as
 * easily as a literal can: a URL-bearing prop refuses a script scheme, and a `data:` URL that is not an
 * image, audio or video.
 *
 * The CSP is the second layer under this one. Either alone would hold; both are here so that a
 * misconfigured policy, or a host that cannot set one, does not reopen the hole.
 */

/** Native elements a schema may mount. Everything here only displays, groups, or takes input. */
export const TEMPLATE_HTML_ELEMENTS: ReadonlySet<string> = new Set([
  // Sections and grouping
  'div',
  'span',
  'section',
  'article',
  'aside',
  'main',
  'nav',
  'header',
  'footer',
  'address',
  'hgroup',
  'search',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'hr',
  'br',
  'wbr',
  // Headings and text
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'em',
  'strong',
  'small',
  'sub',
  'sup',
  'b',
  'i',
  'u',
  's',
  'q',
  'cite',
  'code',
  'kbd',
  'samp',
  'var',
  'mark',
  'abbr',
  'dfn',
  'data',
  'time',
  'del',
  'ins',
  'bdi',
  'bdo',
  'ruby',
  'rt',
  'rp',
  // Lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'menu',
  // Tables
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  // Media
  'img',
  'picture',
  'source',
  'track',
  'video',
  'audio',
  'canvas',
  // Forms
  'form',
  'fieldset',
  'legend',
  'label',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'output',
  'progress',
  'meter',
  // Interactive
  'details',
  'summary',
  'dialog',
]);

/** Whether a lowercase type is a native element a schema may mount. */
export function isTemplateElement(type: string): boolean {
  return TEMPLATE_HTML_ELEMENTS.has(type);
}

/** Props that hold a URL the browser will load or navigate to. */
const URL_PROPS = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'formAction',
  'poster',
  'data',
  'background',
  'ping',
  'cite',
  'codebase',
  'manifest',
  'xlinkHref',
  'xlink:href',
]);

/** A scheme that runs code when loaded or followed. */
const SCRIPT_SCHEME = /^\s*(javascript|vbscript):/i;
/** A `data:` URL — permitted only when it is something to look at or listen to. */
const DATA_SCHEME = /^\s*data:/i;
const MEDIA_DATA = /^\s*data:(image|audio|video)\//i;

/**
 * Why a prop may not reach an element, or null when it may.
 *
 * Checked against the RESOLVED value, so an expression that builds `javascript:` is caught as surely as
 * a literal. Three refusals:
 *
 * - **`srcdoc`, on anything** — it is a whole document, inline.
 * - **A string in a lowercase `on…` prop of a native element** — `onerror`, `onclick`. The handler
 *   shape is `onError`, built by the renderer from a handler token; spread onto a native element, a
 *   lowercase one carrying a string is an inline script, and it throws while mounting and takes the
 *   whole render down. Native only, because a component's prop called `only` or `once` is innocent.
 * - **A URL prop with a script scheme, or a `data:` URL that is not media.**
 */
export function refusedProp(key: string, value: unknown, native: boolean): string | null {
  if (key === 'srcdoc') return 'an inline document';
  if (native && /^on[a-z]/.test(key) && typeof value === 'string') return 'an inline event handler';
  if (typeof value !== 'string' || !URL_PROPS.has(key)) return null;
  if (SCRIPT_SCHEME.test(value)) return 'a script URL';
  if (DATA_SCHEME.test(value) && !MEDIA_DATA.test(value)) return 'a data URL that is not an image, audio or video';
  return null;
}
