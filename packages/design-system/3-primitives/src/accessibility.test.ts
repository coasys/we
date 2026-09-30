/**
 * An axe pass over the primitives that carry a role, so accessibility is a number rather than an
 * impression.
 *
 * The 2026-09-05 audit could say only that 224 `aria-*`/`role=` attributes appear in this package,
 * which is evidence that somebody was thinking about it and no evidence at all that the result is
 * right. Nothing in the 252 test files asserted anything about it. This file is the smallest thing
 * that turns that into a measurement.
 *
 * ## What jsdom can and cannot answer, and why the rule set is narrowed
 *
 * axe's rules divide into ones that read the accessibility tree and ones that need layout or paint.
 * jsdom builds the first and none of the second: every rect is zero and no style is computed, so
 * `color-contrast` cannot run at all, and the target-size and reflow rules would report against
 * geometry that does not exist. Leaving them enabled would produce either noise or — worse — a
 * green result that looks like it covered contrast when it did not.
 *
 * So this asserts what is genuinely checkable here: that an interactive primitive exposes a role,
 * that it has an accessible name, that the ARIA it sets is valid and permitted for that role, and
 * that required parent/child relationships hold. Those are real bugs and the common ones.
 *
 * **Contrast is still unmeasured.** `@we/themes` computes foreground colours against their
 * backgrounds at apply time and has 431 tests over that arithmetic, which is a stronger guarantee
 * than a spot check would be — but it is a different guarantee, and neither it nor this file is a
 * substitute for running axe against a real browser. Treat a green run here as "the semantics are
 * sound", not as "the design system is accessible".
 */
import './primitives/alert';
import './primitives/badge';
import './primitives/button';
import './primitives/checkbox';
import './primitives/form-field';
import './primitives/input';
import './primitives/link';
import './primitives/number-input';
import './primitives/progress-bar';
import './primitives/radio';
import './primitives/select';
import './primitives/slider';
import './primitives/switch';
import './primitives/tag';
import './primitives/textarea';

import axe, { type Result, type RuleObject } from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Rules that need layout, paint or a viewport. Disabled with a reason rather than by an allowlist
 * of the ones that pass, so a rule axe adds later runs by default and this file fails loudly rather
 * than silently narrowing.
 */
const NEEDS_A_REAL_BROWSER: RuleObject = {
  'color-contrast': { enabled: false },
  'color-contrast-enhanced': { enabled: false },
  'target-size': { enabled: false },
  'scrollable-region-focusable': { enabled: false },
  // Page-level rules: they judge a document, and each case here mounts one component.
  region: { enabled: false },
  'page-has-heading-one': { enabled: false },
  'landmark-one-main': { enabled: false },
  'html-has-lang': { enabled: false },
  bypass: { enabled: false },
};

let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

/** Mount markup, let Lit settle, and return axe's verdict on it. */
async function violationsFor(markup: string): Promise<Result[]> {
  host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);

  await Promise.all(
    [...host.querySelectorAll('*')].map((el) => (el as { updateComplete?: Promise<unknown> }).updateComplete),
  );

  const run = await axe.run(host, { rules: NEEDS_A_REAL_BROWSER });
  return run.violations;
}

/** axe's own summary, which names the element and the fix — better than a bare count. */
function describeViolations(violations: Result[]): string {
  return violations.map((v) => `${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.html).join('\n    ')}`).join('\n  ');
}

const CASES: { name: string; markup: string }[] = [
  { name: 'we-button with a label', markup: '<we-button>Save</we-button>' },
  {
    name: 'we-button, icon-only, labelled',
    markup: '<we-button label="Close"><we-icon name="x"></we-icon></we-button>',
  },
  { name: 'we-input with a label', markup: '<we-input label="Space name" value=""></we-input>' },
  { name: 'we-textarea with a label', markup: '<we-textarea label="Description"></we-textarea>' },
  { name: 'we-checkbox with a label', markup: '<we-checkbox label="Listed"></we-checkbox>' },
  { name: 'we-radio with a label', markup: '<we-radio name="access" label="Personal"></we-radio>' },
  { name: 'we-switch with a label', markup: '<we-switch label="Extract calls"></we-switch>' },
  { name: 'we-slider with a label', markup: '<we-slider label="Saturation" value="40"></we-slider>' },
  { name: 'we-number-input with a label', markup: '<we-number-input label="Port" value="12000"></we-number-input>' },
  { name: 'we-link', markup: '<we-link href="/spaces">Spaces</we-link>' },
  {
    name: 'we-progress-bar with a label',
    markup: '<we-progress-bar label="Importing" value="40" max="100"></we-progress-bar>',
  },
  {
    // Unlabelled it must be silent rather than nameless — see the role assertions below.
    name: 'we-progress-bar without one',
    markup: '<we-progress-bar value="40" max="100"></we-progress-bar>',
  },
  { name: 'we-alert', markup: '<we-alert variant="warning">The executor is not running.</we-alert>' },
  { name: 'we-tag', markup: '<we-tag>design</we-tag>' },
  { name: 'we-badge', markup: '<we-badge>3</we-badge>' },
  {
    name: 'we-form-field wrapping an input, with an error',
    markup:
      '<we-form-field label="Email" error="Enter an email address"><we-input label="Email"></we-input></we-form-field>',
  },
];

describe('the primitives that carry a role survive an axe pass', () => {
  for (const { name, markup } of CASES) {
    it(name, async () => {
      const violations = await violationsFor(markup);
      expect(violations, `\n  ${describeViolations(violations)}\n`).toEqual([]);
    });
  }
});

describe('the pass is actually running', () => {
  // Without this the suite above is indistinguishable from one where axe silently no-ops — which is
  // the failure mode of every accessibility check that was added and never seen to fail.
  it('reports a violation when one is planted', async () => {
    const violations = await violationsFor('<img src="/x.png">');
    expect(violations.map((v) => v.id)).toContain('image-alt');
  });

  it('still has colour contrast switched off, so a green run does not claim to cover it', () => {
    expect(NEEDS_A_REAL_BROWSER['color-contrast']).toEqual({ enabled: false });
  });
});

describe('we-progress-bar announces a subject or stays out of the tree', () => {
  // This is what the axe pass found on its first run: the bar carried role="progressbar" with
  // aria-valuenow and no name, so a screen reader read "40%" of nothing identifiable. Asserted
  // directly as well as through axe, because the rule that caught it is one an allowlist could
  // later switch off without anybody noticing what it had been protecting.
  async function base(markup: string): Promise<Element> {
    host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    const bar = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
    await bar.updateComplete;
    return bar.shadowRoot!.querySelector('[part="base"]')!;
  }

  it('carries the role and the values when it has a label', async () => {
    const el = await base('<we-progress-bar label="Importing" value="40" max="100"></we-progress-bar>');
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-label')).toBe('Importing');
    expect(el.getAttribute('aria-valuenow')).toBe('40');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
  });

  it('drops the role entirely when it has none, rather than exposing a nameless one', async () => {
    const el = await base('<we-progress-bar value="40" max="100"></we-progress-bar>');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('aria-valuenow')).toBeNull();
  });
});

describe('we-button says whether it is open, when it opens something', () => {
  /*
    A folding section's heading, a nav group, a row that opens its people: each is a button whose
    whole job is to report the state of something else, and a screen reader learns that from
    `aria-expanded` alone. Every one of them was silent — a schema assigns props as DOM properties,
    so a template cannot set an attribute the component does not declare, and this one did not.

    Asserted directly rather than through axe because the failure is an ABSENT attribute, which is
    valid markup: nothing in a rule set can see that a particular button was supposed to be a
    disclosure.
  */
  async function attribute(markup: string, expanded?: boolean): Promise<string | null> {
    host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    const button = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown>; expanded?: boolean };
    /*
      Set as a PROPERTY, because `false` has no attribute form on a boolean prop — presence is
      truth — and because a property is how it arrives in practice: the schema renderer assigns
      every prop as a DOM property, which is the whole reason a template could not reach this
      before it was declared.
    */
    if (expanded !== undefined) button.expanded = expanded;
    await button.updateComplete;
    return button.shadowRoot!.querySelector('[part="base"]')!.getAttribute('aria-expanded');
  }

  it('reports open and closed', async () => {
    expect(await attribute('<we-button>Logs</we-button>', true)).toBe('true');
    expect(await attribute('<we-button>Logs</we-button>', false)).toBe('false');
  });

  it('says nothing at all on a button that opens nothing', async () => {
    /*
      The case the three-valued prop exists for, and the reason `false` is not the default:
      `aria-expanded="false"` announces an ordinary button as a collapsed disclosure and invites a
      press that will do nothing of the kind. Silence is the correct answer for almost every button
      in the app.
    */
    expect(await attribute('<we-button variant="primary">Save</we-button>')).toBeNull();
  });

  it('says it on a link-shaped button too', async () => {
    // `href` renders an anchor with role="button" down a separate path, which is exactly the kind
    // of branch an attribute gets added to one side of.
    expect(await attribute('<we-button href="/logs">Logs</we-button>', true)).toBe('true');
  });
});
