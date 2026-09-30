/**
 * A `$if` in a **non-event** prop position, resolving to an action.
 *
 * This is what `discardGuard` is built on: `we-modal`'s `close` is a plain callback property, not
 * an `onSomething` handler, so it misses the dispatcher's handler-array path entirely — a
 * `close: [...]` array would be assigned to the element as an array and crash when called. The
 * guard therefore writes a single `$if` token whose branches are actions, and relies on three
 * things being true at once:
 *
 * - the prop resolves to a *callable*, not to the reactive accessor `$if` returns internally;
 * - the branch is chosen when the callback fires, not when the node rendered;
 * - the choice tracks the condition, so a form that becomes dirty starts guarding without a
 *   remount.
 *
 * All three are load-bearing and none is obvious from the call site, which is why they are pinned
 * here rather than left to the fragment's own shape test.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

/** Stands in for `we-modal`: takes `close` as a bare callback and offers a way to fire it. */
const Probe = (props: { close?: unknown; value?: unknown }) => (
  <div>
    <button data-testid="fire" onClick={() => (props.close as () => void)()}>
      close
    </button>
    <span data-testid="type">{typeof props.close}</span>
    <span data-testid="state">{String(props.value)}</span>
  </div>
);
const registry: ComponentRegistry = { Probe: Probe as never };

/** A modal-shaped node: `dirty` decides whether `close` asks or closes. */
const guarded: SchemaNode = {
  type: 'div',
  $localState: {
    dirty: { type: 'boolean', initial: false },
    asked: { type: 'boolean', initial: false },
    closed: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Probe',
      props: {
        close: {
          $if: {
            condition: { $: 'local.dirty' },
            then: { $setLocal: 'asked', value: true },
            else: { $setLocal: 'closed', value: true },
          },
        },
        value: { $: '`${local.asked}/${local.closed}`' },
      },
    },
    // The control that dirties the form, standing in for a field.
    {
      type: 'Probe',
      props: { close: { $setLocal: 'dirty', value: true }, value: { $: 'local.dirty' } },
    },
  ],
};

describe('a $if action in a plain callback prop', () => {
  it('arrives as a callable, not as the reactive accessor $if wraps it in', () => {
    const { getAllByTestId } = render(() => <RenderSchema node={guarded} stores={{}} registry={registry} />);
    expect(getAllByTestId('type')[0].textContent).toBe('function');
  });

  it('takes the else branch while the condition is false', () => {
    const { getAllByTestId } = render(() => <RenderSchema node={guarded} stores={{}} registry={registry} />);
    getAllByTestId('fire')[0].click();
    expect(getAllByTestId('state')[0].textContent).toBe('false/true');
  });

  it('switches to the then branch once the condition flips, with no remount', () => {
    const { getAllByTestId } = render(() => <RenderSchema node={guarded} stores={{}} registry={registry} />);
    // Dirty the form through the second probe…
    getAllByTestId('fire')[1].click();
    expect(getAllByTestId('state')[1].textContent).toBe('true');
    // …and the same close now asks instead of closing.
    getAllByTestId('fire')[0].click();
    expect(getAllByTestId('state')[0].textContent).toBe('true/false');
  });
});
