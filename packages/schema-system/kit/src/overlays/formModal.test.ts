/**
 * The one thing `formModal` promises beyond arranging a dialog: it closes when the submit lands.
 *
 * That promise is kept by attaching `onSuccess` to the action, and an action is not always the
 * thing it is handed. A submit that chooses between two actions is a `$if` token, which runs a
 * branch rather than settling, so an `onSuccess` beside it is read by nothing — the close was
 * composed, validated, shipped, and never ran.
 */
import { describe, expect, it } from 'vitest';

import { formModal } from './formModal';

const close = { $setLocal: 'open', value: false };
const base = { open: { $: 'local.open' }, close, title: 'T', children: [] };

/** The submit button's handler, wherever the modal put it. */
function onClickOf(node: unknown): Record<string, unknown> {
  const found: Record<string, unknown>[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const record = n as Record<string, unknown>;
    const props = record.props as Record<string, unknown> | undefined;
    if (record.type === 'we-button' && props?.onClick) found.push(props.onClick as Record<string, unknown>);
    Object.values(record).forEach(walk);
  };
  walk(node);
  // The last button is Save; Cancel comes first.
  return found[found.length - 1];
}

describe('formModal closes when the submit succeeds', () => {
  it('puts the close on a plain action, after anything the caller asked for', () => {
    const submit = { $action: 'store.save', args: [], onSuccess: [{ $action: 'store.ping' }] };
    const onClick = onClickOf(formModal({ ...base, submit }));

    expect(onClick.onSuccess).toEqual([close, { $action: 'store.ping' }]);
  });

  it('puts it down BOTH branches when the submit chooses between actions', () => {
    const submit = {
      $if: {
        condition: { $: 'local.existing' },
        then: { $action: 'store.move', args: [] },
        else: { $action: 'store.create', args: [] },
      },
    };
    const onClick = onClickOf(formModal({ ...base, submit }));

    // Not beside the token, where nothing reads it.
    expect(onClick.onSuccess).toBeUndefined();

    const branches = onClick.$if as { then: Record<string, unknown>; else: Record<string, unknown> };
    expect(branches.then.onSuccess).toEqual([close]);
    expect(branches.else.onSuccess).toEqual([close]);
  });

  it('leaves a branch that is a list of handlers as a list, with the close last', () => {
    const submit = {
      $if: { condition: { $: 'local.x' }, then: [{ $touch: '$all' }, { $action: 'store.save' }] },
    };
    const onClick = onClickOf(formModal({ ...base, submit }));
    const branches = onClick.$if as { then: unknown[]; else?: unknown };

    expect(branches.then).toEqual([{ $touch: '$all' }, { $action: 'store.save', onSuccess: [close] }]);
    expect(branches.else).toBeUndefined(); // a branch the caller did not write is not invented
  });
});
