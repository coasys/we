/**
 * `we-textarea`'s `rows`.
 *
 * It was passed to the inner element all along and then overridden in CSS: a hard `min-height` of
 * 80px is about three lines, so any value below the default rendered at three rows and read as the
 * prop being ignored.
 */
import { describe, expect, it } from 'vitest';

import Textarea from './textarea';

describe('rows', () => {
  it('reaches the element that renders them', async () => {
    const el = document.createElement('we-textarea') as HTMLElement & {
      rows: number;
      updateComplete: Promise<unknown>;
    };
    el.rows = 1;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('textarea')?.getAttribute('rows')).toBe('1');
  });

  it('is floored at one control height, on the base rather than the box inside it', () => {
    /*
      The floor belongs to the *control*, which is `[part='base']` — the element carrying the border,
      and the one `box-sizing: border-box` therefore measures from the outside. It used to sit on the
      inner textarea, which made the text one control tall and then drew the border around it: every
      textarea stood two pixels proud of the input or button beside it, at every size. Fixing the
      inner box was half the job and looked like all of it.

      `we-input` and `we-button` both put their height on the base, which is why they agree.
    */
    // Comments stripped first: these blocks argue about the very declarations being asserted on, so
    // a plain `toContain` finds the prose and passes whatever the CSS says. The same reason
    // `themeReach.test.ts` reads declarations rather than source.
    const declarations = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
    const sheet = (Textarea.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');
    const base = declarations(/\[part='base'\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '');
    const inner = declarations(/\[part='textarea'\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '');

    expect(base).toContain('min-height: var(--we-textarea-control-height');
    expect(inner).not.toContain('min-height');
    expect(base).not.toContain('min-height: 80px');
  });

  it('leaves the border room inside that floor, so one row lands on it exactly', () => {
    /*
      The padding has to aim at the control height *less* the border, or the text fills the whole
      floor and the border pushes the control past it — which is the same two pixels from the other
      direction. CSS cannot read a width out of a border shorthand, so the primitive names it.
    */
    const sheet = (Textarea.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');
    expect(sheet).toContain('--we-textarea-border-width: 1px');
    expect(sheet).toMatch(/2\s*\*\s*\n?\s*var\(--we-textarea-border-width\)/);
  });

  it('takes that floor from its own size rather than always from md', () => {
    /*
      The floor was `--we-component-height-md` at every size, so a small textarea stood a few pixels
      taller than the small input and button beside it — and no call site could fix it, because the
      number came from a different size than the row was built at. Each size names its own, through
      the same expression `we-input` uses.
    */
    const sheet = (Textarea.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');

    for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) {
      const block = new RegExp(`:host\\(\\[size='${size}'\\]\\)\\s*\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';
      expect(block, `size ${size}`).toContain(`--we-textarea-control-height: calc(var(--we-component-height-${size})`);
      // The theme's control-height offset travels with it, or a themed row drifts apart again.
      expect(block, `size ${size}`).toContain('--we-theme-control-height-offset');
    }
  });
});

/**
 * Enter as a commit, and why the primitive holds it.
 *
 * A schema can read the event and has nothing that calls `preventDefault`, so the same rule written
 * in a template would send the message *and* leave a stray newline in the box. Only code can hold
 * this — which is the same reason `field` stayed a fragment rather than becoming an operator.
 */
describe('submitOnEnter', () => {
  async function box(props: Partial<{ submitOnEnter: boolean; value: string }> = {}) {
    const el = document.createElement('we-textarea') as HTMLElement & {
      updateComplete: Promise<unknown>;
      submitOnEnter: boolean;
      value: string;
    };
    Object.assign(el, props);
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const press = (el: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true, ...init });
    el.shadowRoot?.querySelector('textarea')?.dispatchEvent(event);
    return event;
  };

  it('emits what was typed, and suppresses the newline that would follow', async () => {
    const el = await box({ submitOnEnter: true, value: 'a note' });
    let sent = '';
    // Through `unknown`, unlike the plain cast every other primitive's tests use: `submit` is a name
    // the DOM already owns, so the listener is typed `SubmitEvent` and neither type is the other's.
    el.addEventListener('submit', (e) => (sent = (e as unknown as CustomEvent).detail));

    const event = press(el, {});

    expect(sent).toBe('a note');
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Shift+Enter alone, which is the new line', async () => {
    const el = await box({ submitOnEnter: true, value: 'a note' });
    let sent = false;
    el.addEventListener('submit', () => (sent = true));

    const event = press(el, { shiftKey: true });

    expect(sent).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not commit an empty box, so no consumer has to remember to check', async () => {
    const el = await box({ submitOnEnter: true, value: '   ' });
    let sent = false;
    el.addEventListener('submit', () => (sent = true));

    press(el, {});

    expect(sent).toBe(false);
  });

  it('leaves a keystroke alone while an input method is composing', async () => {
    /*
      Enter confirms a candidate word mid-composition in Japanese, Chinese and Korean input. Sending
      on it would make the box unusable in those languages — invisible until somebody who needs it
      tries.
    */
    const el = await box({ submitOnEnter: true, value: 'a note' });
    let sent = false;
    el.addEventListener('submit', () => (sent = true));

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    el.shadowRoot?.querySelector('textarea')?.dispatchEvent(event);

    expect(sent).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing at all unless asked, so the general path is untouched', async () => {
    // Off by default: a consumer wanting other keys binds onKeyDown and this never fires.
    const el = await box({ value: 'a note' });
    let sent = false;
    el.addEventListener('submit', () => (sent = true));

    const event = press(el, {});

    expect(sent).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

/**
 * Growing, when the line height cannot be read as a number.
 *
 * The shared reset sets line-height to the theme's value falling back to "normal", so on any theme
 * with no opinion the computed value is that string — and parseFloat of it is NaN. The row
 * arithmetic collapsed to zero, which pinned the box to its floor and made the overflow test always
 * true: a single line got a scrollbar, and typing a second one grew nothing.
 *
 * jsdom performs no layout, so every measurement it reports is zero and the faulty arithmetic and
 * the fixed one agree — a test written against it passes either way and pins nothing. The browser
 * is therefore stood up explicitly: real padding, a real scroll height, and a line-height of
 * "normal", which is the exact reading that broke it.
 */
describe('autoGrow with an unreadable line height', () => {
  const FONT = 16;
  const PADDING = 8;

  /** A textarea that has been laid out — `content` lines of it, with the CSS the reset produces. */
  const laidOut = async (lines: number, props: Record<string, unknown> = {}) => {
    const el = document.createElement('we-textarea') as HTMLElement & {
      updateComplete: Promise<unknown>;
      [k: string]: unknown;
    };
    Object.assign(el, { autoGrow: true, maxRows: 6, value: 'x', ...props });
    document.body.appendChild(el);
    await el.updateComplete;
    const field = el.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;

    // What a browser would report, and what jsdom will not.
    Object.defineProperty(field, 'scrollHeight', { configurable: true, value: lines * FONT * 1.2 + PADDING * 2 });
    Object.defineProperty(field, 'offsetHeight', { configurable: true, value: 0 });
    Object.defineProperty(field, 'clientHeight', { configurable: true, value: 0 });
    const real = window.getComputedStyle;
    window.getComputedStyle = ((node: Element) =>
      node === field
        ? // `normal` is what the reset resolves to on a theme that sets no line height.
          { lineHeight: 'normal', fontSize: `${FONT}px`, paddingTop: `${PADDING}px`, paddingBottom: `${PADDING}px` }
        : real(node)) as typeof window.getComputedStyle;
    try {
      field.dispatchEvent(new Event('input'));
    } finally {
      window.getComputedStyle = real;
    }
    return field;
  };

  it('grows to fit rather than collapsing to its floor', async () => {
    const field = await laidOut(2);
    // Two lines and the padding — a real height, where the faulty maths capped it at 0px.
    expect(Number.parseFloat(field.style.height)).toBeCloseTo(2 * FONT * 1.2 + PADDING * 2, 1);
  });

  it('does not scroll while the content still fits', async () => {
    const field = await laidOut(2);
    expect(field.style.overflowY).toBe('hidden');
  });

  it('scrolls once past maxRows, counting the padding as part of the cap', async () => {
    // Ten rows against a cap of six: comfortably over however the line height is approximated.
    const field = await laidOut(10);
    expect(field.style.overflowY).toBe('auto');
  });

  it('leaves the box alone when nobody asked it to grow', async () => {
    const el = document.createElement('we-textarea') as HTMLElement & { updateComplete: Promise<unknown> };
    document.body.appendChild(el);
    await el.updateComplete;
    const field = el.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;

    // No inline height and no overflow rule: the CSS resize handle stays the mechanism.
    expect(field.style.height).toBe('');
    expect(field.style.overflowY).toBe('');
  });
});

/**
 * One row is one control tall, at every size.
 *
 * The vertical padding used to be a fixed 8px, which is md's answer — a 40px control less a 24px
 * line box, halved. Every other size inherited it and overshot: at sm a 21px line inside 16px of
 * padding is 37px in a row built for 32, so the box stood proud of the button beside it and
 * `min-height` could do nothing, 37px of content being 37px tall.
 *
 * Asserted on the declaration rather than on a computed pixel, because jsdom resolves neither `calc`
 * nor a custom property — and the thing that was wrong was the *rule*, not the layout engine.
 */
describe('the vertical padding', () => {
  const css = () => (Textarea as unknown as { styles: { cssText: string }[] }).styles.map((s) => s.cssText).join('\n');

  it('is derived from the control height rather than pinned to one size', () => {
    const rule = css();
    expect(rule).toContain('--we-textarea-control-height');
    // The line box, as 1em times the ratio — which is what avoids the `lh` unit.
    expect(rule).toMatch(/1em\s*\*/);
  });

  it('sets the horizontal half from the size too, not md for everybody', () => {
    /*
      12px at every size meant a small box gave up a third more of its width to padding than its
      type warranted, and the text sat visibly inset. SIZE_DEFAULTS already declares the px per
      size; `nativePadding` is what stopped it ever reaching the element.
    */
    const rule = css();
    expect(rule).toContain('--we-textarea-padding-x: var(--we-space-200)');
    expect(rule).toContain('var(--we-textarea-padding-x');
  });

  it('never goes negative, however tall a theme sets its type', () => {
    // A theme whose line box exceeds its control height should get no padding, not a negative one.
    expect(css()).toMatch(/max\(\s*0px/);
  });

  it('still lets a theme or a call site set padding outright', () => {
    /*
      The derivation is the *innermost* fallback, so every override still wins: the call site's own
      variable, then the theme's textarea slot, then the input group it belongs to. Read out of the
      padding declaration itself — the control height is also named up in the size blocks, so
      comparing positions across the whole sheet compares the wrong occurrence.
    */
    const declaration = /padding:\s*var\(([\s\S]*?)\n\s{4}\);/.exec(css())?.[1] ?? '';
    const order = ['--we-textarea-padding', '--we-theme-textarea-padding', '--we-theme-input-padding', 'max('].map(
      (name) => declaration.indexOf(name),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
