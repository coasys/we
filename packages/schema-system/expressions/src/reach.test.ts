/**
 * A template's expressions stop at the page (coasys/we#282).
 *
 * The first block is the attack, by every route that reached it; the second is everything templates
 * actually read off a callback's argument, which must keep working. A rule that passed the first by
 * refusing the second would be a rule nobody could ship.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { callbackValue, evaluateExpression } from './evaluate';
import { listFunctions } from './functions';
import { parseExpression } from './parser';

const env = (roots: Record<string, unknown>) => ({
  root: (name: string) => ({ bound: name in roots, value: roots[name] }),
  call: (name: string, args: unknown[]) =>
    listFunctions()
      .find((f) => f.name === name)
      ?.impl(args, { context: {}, stores: {} }),
});

const read = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), env(roots));

/** A click on a button in the page, as a handler receives it. */
function click(): { event: MouseEvent; button: HTMLButtonElement } {
  const button = document.createElement('button');
  document.body.appendChild(button);
  const event = new MouseEvent('click');
  Object.defineProperty(event, 'target', { value: button });
  return { event, button };
}

beforeEach(() => {
  localStorage.setItem('0.13.1/ad4m-token', 'TOP-SECRET');
  document.cookie = 'session=abc123';
});

afterEach(() => {
  localStorage.clear();
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.body.replaceChildren();
});

describe('an expression cannot reach the page', () => {
  it('through the event a handler was given', () => {
    const { event } = click();
    const roots = { event: callbackValue(event) };

    expect(read('event.target.ownerDocument.cookie', roots)).toBeUndefined();
    expect(read("event.target.ownerDocument.defaultView.localStorage['0.13.1/ad4m-token']", roots)).toBeUndefined();
    expect(read('event.target.ownerDocument.defaultView.location.href', roots)).toBeUndefined();
    expect(read('event.view', roots)).toBeUndefined();
    expect(read('event.target.parentNode', roots)).toBeUndefined();
  });

  it('through a node it was handed and kept', () => {
    // `{ $: 'event.target' }` settles to the element itself, which `$setLocal` stores. Walking it
    // later goes through `readProperty`, not `callbackValue`, and must stop all the same.
    const { event, button } = click();
    const kept = read('event.target', { event: callbackValue(event) });
    expect(kept).toBe(button);

    expect(read('local.ownerDocument.cookie', { local: kept })).toBeUndefined();
    expect(read("local['ownerDocument']", { local: kept })).toBeUndefined();
  });

  it('through the function library', () => {
    const { button } = click();

    expect(read("pick(node, ['ownerDocument'])", { node: button })).toEqual({});
    expect(read("pick(doc, ['cookie'])", { doc: document })).toEqual({});
    // A where-object is a field read too, and a yes/no answer about a secret is a way to read it.
    expect(read("filter([doc], { cookie: { contains: 'session' } })", { doc: document })).toEqual([]);
    expect(read('find([store], { length: 1 })', { store: localStorage })).toBeUndefined();
  });

  it('through a page object found in data', () => {
    // A store value, a record, a component's payload: whatever holds it, the page is not data.
    expect(read('holder.win.localStorage', { holder: { win: window } })).toBeUndefined();
    expect(read('holder.doc.cookie', { holder: { doc: document } })).toBeUndefined();
    expect(read('holder.storage.length', { holder: { storage: localStorage } })).toBeUndefined();
  });

  it('cannot obtain a page function, which would otherwise be callable', () => {
    const { event } = click();
    const roots = { event: callbackValue(event) };

    expect(read('event.preventDefault', roots)).toBeUndefined();
    expect(read('event.target.remove', roots)).toBeUndefined();
    expect(read('event.target.click', roots)).toBeUndefined();
  });
});

describe('what templates read off a callback still reads', () => {
  it("an event's own fields", () => {
    const custom = new CustomEvent('change', { detail: { value: 'b', ids: ['x', 'y'] } });
    expect(read('event.detail.value', { event: callbackValue(custom) })).toBe('b');
    expect(read('event.detail.ids', { event: callbackValue(custom) })).toEqual(['x', 'y']);
    expect(read('event.type', { event: callbackValue(custom) })).toBe('change');

    const key = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
    expect(read("event.key == 'Enter' && event.shiftKey", { event: callbackValue(key) })).toBe(true);
  });

  it("a form control's value", () => {
    const input = document.createElement('input');
    input.value = 'typed';
    const event = new Event('input');
    Object.defineProperty(event, 'target', { value: input });
    expect(read('event.target.value', { event: callbackValue(event) })).toBe('typed');
    expect(read('arg.target.value', { arg: callbackValue(event) })).toBe('typed');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    expect(read('node.checked', { node: box })).toBe(true);
  });

  it("a custom element's own value", () => {
    class WeField extends HTMLElement {
      #value = 'from the element';
      get value() {
        return this.#value;
      }
    }
    customElements.define('we-reach-field', WeField);
    const field = document.createElement('we-reach-field');
    expect(read('node.value', { node: field })).toBe('from the element');
    expect(read('node.ownerDocument', { node: field })).toBeUndefined();
  });

  it('a function the host handed over on purpose', () => {
    let saved = 0;
    const ready = callbackValue({ save: () => saved++ });
    const save = read('event.save', { event: ready }) as () => void;
    expect(typeof save).toBe('function');
    save();
    expect(saved).toBe(1);
  });

  it('the argument itself, passed on whole', () => {
    const { event, button } = click();
    expect(read('event', { event: callbackValue(event) })).toBe(event);
    expect(read('event.target', { event: callbackValue(event) })).toBe(button);
    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    expect(read('event.detail', { event: callbackValue(new CustomEvent('pick', { detail: file })) })).toBe(file);
    expect(read('event.detail.name', { event: callbackValue(new CustomEvent('pick', { detail: file })) })).toBe(
      'photo.png',
    );
  });

  it("a failed action's error", () => {
    const error = Object.assign(new Error('Not allowed'), { status: 403 });
    expect(read('result.message', { result: callbackValue(error) })).toBe('Not allowed');
    expect(read('result.status', { result: callbackValue(error) })).toBe(403);
  });

  it('a record, getters included, and a list', () => {
    class Record {
      title = 'Hello';
      get label() {
        return `${this.title}!`;
      }
    }
    const row = new Record();
    expect(read('row.title', { row })).toBe('Hello');
    expect(read('row.label', { row })).toBe('Hello!');
    expect(read('rows.length', { rows: [1, 2, 3] })).toBe(3);
    expect(read("pick(row, ['title'])", { row })).toEqual({ title: 'Hello' });
    expect(read("filter([row], { title: 'Hello' })", { row })).toEqual([row]);
    expect(read('bare.x', { bare: Object.assign(Object.create(null), { x: 1 }) })).toBe(1);
  });
});
