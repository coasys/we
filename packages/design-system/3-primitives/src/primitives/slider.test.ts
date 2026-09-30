/**
 * What `change` means on a slider, and why it is not the native answer.
 *
 * A native range input dispatches `change` only when the number *differs* from what it was. That is
 * the wrong question here, and the failure it produced was specific and invisible: a slider showing
 * its minimum because nobody has answered looks exactly like one showing its minimum because
 * somebody chose it, so dragging the thumb to the bottom of an unanswered slider moved nothing and
 * wrote nothing. The strongest answer on the scale was the one answer that could not be given
 * first — and it looked like the control simply ignoring you.
 *
 * So a press that ends on the control commits what it is on. These tests pin that, and the thing it
 * must not do: fire twice for one gesture.
 *
 * ## The order below is measured, and it is not the same everywhere
 *
 * On a bare `<input type="range">` Chrome dispatches `pointerdown > input… > pointerup > change`:
 * the native change arrives AFTER the release. These tests originally had it the other way round,
 * which is worth knowing because a test written against an assumed sequence is a restatement of the
 * assumption rather than a check on it.
 *
 * Driven through this element, though, real Chrome fires **no** native change after a drag at all —
 * measured by the browser harness (`@we/app-shell test:browser`, case `sliderDrag`), which records
 * the sequence on the inner input. The likely reason is that Lit re-sets `.value` on every `input`,
 * which moves the baseline Chrome compares against when deciding whether anything changed.
 *
 * So the echo guard below is defensive rather than a fix for something observed here: it is what
 * keeps a browser that DOES deliver that trailing change from turning one gesture into two writes.
 * Two matters because each write is a delete-then-create — see `upsertSignal`, where the pair is
 * serialised for the same reason.
 */
import { describe, expect, it } from 'vitest';

import Slider from './slider';

const css = () => (Slider as unknown as { styles: { cssText: string }[] }).styles.map((s) => s.cssText).join('\n');

/**
 * The stylesheet with its comments stripped.
 *
 * What a "does not contain" assertion has to be made against: the comment explaining why the white
 * ring went *mentions* the white ring, so asserting over the raw text asserts that nobody may
 * describe what was removed. The rules are the subject; the prose beside them is not.
 */
const rules = () => css().replace(/\/\*[\s\S]*?\*\//g, '');

type Mounted = HTMLElement & { updateComplete: Promise<unknown>; value: number };

const mount = async (props: Record<string, unknown> = {}): Promise<Mounted> => {
  const el = document.createElement('we-slider') as Mounted;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

/** The native input inside the shadow root — what a real gesture actually lands on. */
const native = (el: Mounted) => el.shadowRoot!.querySelector('input')! as HTMLInputElement;

/** Every `change` the host dispatched while `run` happened. */
const changesDuring = async (el: Mounted, run: () => void): Promise<number[]> => {
  const seen: number[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent<number>).detail);
  el.addEventListener('change', listener);
  run();
  await el.updateComplete;
  el.removeEventListener('change', listener);
  return seen;
};

describe('a press commits, changed or not', () => {
  it('commits the minimum on a slider nobody has answered', async () => {
    /*
      The bug, exactly. `value` sits at `min` because there is no answer yet, so a drag to the bottom
      leaves the native input where it already was — no native `change`, nothing written, and a
      person who has just deliberately chosen the lowest score watching nothing happen.
    */
    const el = await mount({ min: 0, max: 100, value: 0 });
    const input = native(el);

    const seen = await changesDuring(el, () => {
      input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      // No input event: the value did not move, which is the whole point.
      input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });

    expect(seen).toEqual([0]);
  });

  it('commits once for a gesture that did move', async () => {
    /*
      In the real order: the release commits, and the native change that follows carries the same
      value and is its echo. Two dispatches here are two writes for one drag — and since each is a
      delete-then-create, the second can miss the first's record and leave two.
    */
    const el = await mount({ min: 0, max: 100, value: 0 });
    const input = native(el);

    const seen = await changesDuring(el, () => {
      input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      input.value = '40';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('pointerup', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(seen).toEqual([40]);
  });

  it('does not eat a keyboard change after a press that moved nothing', async () => {
    /*
      Why the echo is matched on its VALUE rather than on a "we already fired" flag. A press that
      moves nothing produces no native change at all, so a flag would still be up when the next
      arrow key arrived — and the keyboard change would vanish with no sign of why.
    */
    const el = await mount({ min: 0, max: 100, value: 10 });
    const input = native(el);

    const seen = await changesDuring(el, () => {
      input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      input.dispatchEvent(new Event('pointerup', { bubbles: true }));
      input.value = '11';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(seen).toEqual([10, 11]);
  });

  it('commits a second drag that ends on the same value as the first', async () => {
    // The echo guard is cleared by the next press, so two identical drags are two answers — which
    // is what "the person settled on this" means, however many times they settle on it.
    const el = await mount({ min: 0, max: 100, value: 0 });
    const input = native(el);

    const twice = () => {
      input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      input.value = '40';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('pointerup', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const seen = await changesDuring(el, () => {
      twice();
      twice();
    });

    expect(seen).toEqual([40, 40]);
  });

  it('still commits a keyboard change, which has no press behind it', async () => {
    const el = await mount({ min: 0, max: 100, value: 10 });
    const input = native(el);

    const seen = await changesDuring(el, () => {
      input.value = '11';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(seen).toEqual([11]);
  });

  it('commits once when the pointer is taken away mid-gesture', async () => {
    /*
      A pointer claimed by something else — a scroll, a drag handled further up. The value has
      already moved as far as every `input` listener is concerned, so leaving it uncommitted would
      put the store behind what the control is showing; `pointercancel` ends the gesture the same
      way a release does.

      What it must not do is end it twice: a cancel followed by the release that usually accompanies
      it is one gesture, so the second one finds no press in flight and stays quiet.
    */
    const el = await mount({ min: 0, max: 100, value: 0 });
    const input = native(el);

    const seen = await changesDuring(el, () => {
      input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      input.dispatchEvent(new Event('pointercancel', { bubbles: true }));
      input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });

    expect(seen).toHaveLength(1);
  });

  it('ignores a press while disabled', async () => {
    const el = await mount({ min: 0, max: 100, value: 0, disabled: true });
    const input = native(el);

    const seen = await changesDuring(el, () => {
      input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });

    expect(seen).toEqual([]);
  });
});

describe('the track reads as a measure rather than a trough', () => {
  it('fills up to the thumb from a pixel stop, not a percentage', () => {
    /*
      A range input's thumb is a box of its own width and travels between its two half-widths, so
      its centre spans `width - thumb`. A fill written as a percentage of the track agrees with the
      thumb in the middle and is half a thumb out at each end — which is exactly where somebody
      looks to check they reached the bottom.
    */
    expect(rules()).toContain('var(--we-role-accent) 0 var(--fill)');
  });

  it('gives the thumb no ring', () => {
    // It was `2px solid white` — a literal colour belonging to no role, so on a dark theme the thumb
    // wore a halo that followed nothing.
    expect(rules()).not.toContain('solid white');
  });
});

describe('the steps, marked or not', () => {
  const ticks = (el: Mounted) => el.shadowRoot!.querySelector('[part="ticks"]');

  it('marks them when the caller says so', async () => {
    const el = await mount({ min: 0, max: 10, step: 1, ticks: 'on' });
    expect(ticks(el)).toBeTruthy();
  });

  it('does not when the caller says not to, however few the steps', async () => {
    const el = await mount({ min: 0, max: 4, step: 1, ticks: 'off' });
    expect(ticks(el)).toBeNull();
  });

  it('draws none before it has been measured', async () => {
    /*
      `auto` is a question about this slider's own width — eleven steps in a panel and a hundred
      across a full screen are both legible, and a hundred in a panel is a grey smear. With no
      layout there is no answer yet, and guessing one means a flash of wrongly spaced marks that
      jump on the first measurement. jsdom has no layout at all, which makes this the case it can
      speak to.
    */
    const el = await mount({ min: 0, max: 4, step: 1, ticks: 'auto' });
    expect(ticks(el)).toBeNull();
  });
});
