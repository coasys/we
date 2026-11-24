/**
 * The line composer's attach control, run through the schema's own resolver: what happens to the
 * chosen files when a send fails, succeeds, or is overtaken by a newer choice.
 */
import { resolveProp } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { ATTACH_MAX_BYTES, lineComposer } from './lineComposer';

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const find = (root: unknown, test: (n: Node) => boolean): Node | undefined => {
  if (!root || typeof root !== 'object') return undefined;
  if (Array.isArray(root)) return root.map((c) => find(c, test)).find(Boolean);
  const node = root as Node;
  if (test(node)) return node;
  return [node.props, node.children].map((c) => find(c, test)).find(Boolean) ?? find(Object.values(node), test);
};

/** A composer whose send is `store.send`, with the locals it declares held in plain variables. */
function mount(send: (files: unknown) => Promise<void>) {
  const tree = lineComposer({
    placeholder: 'Write…',
    sendLabel: 'Send',
    attach: { label: 'Attach files' },
    onSubmit: { $invoke: 'store.send', args: [{ $: 'local.attachments' }] },
  });
  const declared = (tree as { $localState?: Record<string, { initial: unknown }> }).$localState ?? {};
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(declared).map(([k, v]) => [k, v.initial]));
  const context = {
    $local: new Proxy({}, { get: (_t, key: string) => () => values[key] }),
    $localSetters: new Proxy({}, { get: (_t, key: string) => (v: unknown) => void (values[key] = v) }),
  };
  const stores = { store: { send } };
  const run = (handler: unknown, event: unknown = {}) => {
    const resolved = resolveProp(handler, stores, { ...context, event });
    for (const fn of [resolved].flat()) if (typeof fn === 'function') (fn as (e: unknown) => void)(event);
  };
  const composer = find(tree, (n) => n.type === 'BlockComposer')!;
  const upload = find(tree, (n) => n.type === 'we-file-upload')!;
  return {
    tree,
    values,
    submit: () => run(composer.props!.onSubmit, { text: 'hi' }),
    choose: (files: File[]) => run(upload.props!.onChange, { detail: files }),
    reject: (names: string) => run(upload.props!.onReject, { detail: { names } }),
    upload,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const file = (name: string) => new File(['x'], name);

describe('the attach control', () => {
  it('keeps the files when the send fails, so it can be tried again', async () => {
    const m = mount(async () => {
      throw new Error('upload refused');
    });
    const a = file('a.txt');
    m.choose([a]);
    m.submit();
    await flush();
    expect(m.values.attachments).toEqual([a]);
  });

  it('keeps the files while the send is still running, and empties them once it has resolved', async () => {
    let done!: () => void;
    const m = mount(() => new Promise<void>((resolve) => (done = resolve)));
    m.choose([file('a.txt')]);
    m.submit();
    await flush();
    expect(m.values.attachments).toHaveLength(1);
    done();
    await flush();
    expect(m.values.attachments).toEqual([]);
  });

  it('keeps files picked while a slow send ran', async () => {
    let done!: () => void;
    const m = mount(() => new Promise<void>((resolve) => (done = resolve)));
    m.choose([file('a.txt')]);
    m.submit();
    const later = [file('a.txt'), file('b.txt')];
    m.choose(later);
    done();
    await flush();
    expect(m.values.attachments).toBe(later);
  });

  it('refuses a file over the limit with a line saying which, and clears the line when the list changes', () => {
    const m = mount(async () => {});
    expect(m.upload.props?.maxSize).toBe(ATTACH_MAX_BYTES);
    m.reject('huge.bin');
    expect(m.values.attachNote).toBe("Files over 25 MB can't be attached: huge.bin");
    m.choose([file('a.txt')]);
    expect(m.values.attachNote).toBe('');
  });
});
