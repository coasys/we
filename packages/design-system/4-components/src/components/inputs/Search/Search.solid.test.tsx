/**
 * `Search` follows the `value` it is given.
 *
 * It did not: the signal was seeded from the prop once and never looked again, so a "Clear search"
 * button, a filter reset or a route change emptied the list and left the box showing what had been
 * typed. Rendered rather than unit-tested because the whole defect is a *reactive* one — the value
 * arrives, and nothing re-reads it.
 */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Search } from './Search.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** The `<input>` the `we-input` renders — through its shadow root, which is where it lives. */
function field(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('we-input');
  const inner = input?.shadowRoot?.querySelector('input');
  // Falls back to the host's own `value` property where the custom element has not upgraded — the
  // point of these assertions is what the component *passed down*, not how Lit rendered it.
  return (inner ?? { value: (input as unknown as { value: string })?.value }) as HTMLInputElement;
}

describe('Search', () => {
  it('shows the value it is given', () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <Search value="hello" onSearch={() => {}} />, host);

    expect(field(host).value).toBe('hello');
  });

  it('follows the value when the consumer changes it', () => {
    // The clear-search case: the list empties and the box has to empty with it.
    const [value, setValue] = createSignal('hello');
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <Search value={value()} onSearch={() => {}} />, host);

    setValue('');
    expect(field(host).value).toBe('');
  });

  it('does not report a search the consumer has just replaced', () => {
    /*
      A pending debounce belongs to the text that was typed. Left running when the consumer changes
      the value out from under it, it fires afterwards and searches for what was replaced — putting
      the list back to the state the change was undoing.

      The consumer has to actually change `value` for there to be anything to react to: setting it
      to what it already held is not an event, and no reactive system can see one. Which is the real
      sequence anyway — a consumer's `value` is whatever it last heard through `onSearch`.
    */
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const [value, setValue] = createSignal('hello');
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <Search value={value()} onSearch={onSearch} debounce={200} />, host);

    host.querySelector('we-input')?.dispatchEvent(new CustomEvent('input', { detail: 'typed' }));
    setValue('');
    vi.advanceTimersByTime(500);

    expect(onSearch).not.toHaveBeenCalled();
    expect(field(host).value).toBe('');
  });

  it('still reports what was typed when nothing interrupts it', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <Search value="" onSearch={onSearch} debounce={200} />, host);

    host.querySelector('we-input')?.dispatchEvent(new CustomEvent('input', { detail: 'typed' }));
    vi.advanceTimersByTime(200);

    expect(onSearch).toHaveBeenCalledWith('typed');
  });
});
