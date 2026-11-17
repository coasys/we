/**
 * An open panel's body re-rendered whenever *any* instance changed: `TemplatePanelBody` read its
 * own record out of the whole `panelInstances` map inside the memo that renders it, so another
 * panel opening, a space switch republishing the visible set, or the global chat arriving replaced
 * every body's DOM — remounting each open chat back onto its list mid-conversation.
 *
 * The fix tracks each body's own record. What this checks is the observable end of it: the body
 * element stays the same element while unrelated records come and go, and only a change to its own
 * re-renders it.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatePanelBody } from '../src/frameworks/solid/components/TemplatePanelBody';
import { publishPanelInstances } from '../src/shared/registries/panelInstances';
import { provideTemplateBag } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';

let release: (() => void)[] = [];

beforeEach(() => {
  release = [provideTemplateBag({} as never)];
  setTemplatePanels(
    [
      {
        id: 'chat',
        title: 'Chat',
        home: 'floating',
        node: {
          type: 'span',
          props: { class: 'chat-body' },
          children: [{ $: "panel.inputs.label ?? 'empty'" }],
        },
      },
    ],
    'remount-test',
  );
});

afterEach(() => {
  cleanup();
  publishPanelInstances({});
  setTemplatePanels(undefined);
  release.forEach((done) => done());
});

describe('a panel body while other instances change', () => {
  it('stays mounted — only a change to its own record may re-render it', async () => {
    const ada = { id: 'i-ada', panel: 'chat', inputs: { label: 'Ada' }, opened: 1 };
    publishPanelInstances({ 'i-ada': ada });

    const { container } = render(() => <TemplatePanelBody panelId="chat" instance="i-ada" />);
    await vi.waitFor(() => expect(container.querySelector('.chat-body')?.textContent).toBe('Ada'));
    const mounted = container.querySelector('.chat-body');

    // Another panel opening — a new record on the same map, which is what the sparkle and the
    // global chat do — must not touch this one.
    const bo = { id: 'i-bo', panel: 'chat', inputs: { label: 'Bo' }, opened: 2 };
    publishPanelInstances({ 'i-ada': ada, 'i-bo': bo });
    await vi.waitFor(() => expect(container.querySelector('.chat-body')).toBe(mounted));

    // Nor must one closing — a space switch dropping a bound instance from the visible set.
    publishPanelInstances({ 'i-ada': ada });
    await vi.waitFor(() => expect(container.querySelector('.chat-body')).toBe(mounted));

    // Its own record replaced is a real change: the body re-renders with what was opened.
    publishPanelInstances({ 'i-ada': { ...ada, inputs: { label: 'Ana' } } });
    await vi.waitFor(() => expect(container.querySelector('.chat-body')?.textContent).toBe('Ana'));
    expect(container.querySelector('.chat-body')).not.toBe(mounted);
  });
});
