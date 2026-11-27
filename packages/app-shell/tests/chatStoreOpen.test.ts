/*
 * A space's ask opens that space's chat or nothing — never the global chat.
 *
 * "Find or ask" passes the space's local dataset id. Before the space's dataset has loaded that
 * id is undefined, and a store that read "no id" as "global" would answer a question about one
 * space with a chat that reaches every space.
 *
 * And a question never travels in the inputs: `openChat` keeps it behind a nonce it issues, which
 * the chat body spends once — the inputs stay data a template may read, replay or forge without
 * anything being sent.
 *
 * A plain store test, run once under each reactivity port.
 */
import type { ReactivityPort } from '@we/reactivity';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NARROW_VIEWPORT_PX } from '../src/shared/dockGeometry';
import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { type ChatStore, createChatStore } from '../src/shared/stores/ChatStore';
import { reactivityPorts } from './support/engines';

const openPanel = vi.fn((_panel: string, _inputs?: unknown, _options?: unknown) => '');

let port: ReactivityPort = solidReactivity;
let platform: TestPlatform = createTestPlatform();
const disposers: (() => void)[] = [];

/** The chat store over a stand-in shell store, inside a root of its own as the host builds it. */
function withStore(): ChatStore {
  let store!: ChatStore;
  disposers.push(port.root(() => (store = createChatStore({ reactivity: port, platform, shellStore: { openPanel } }))));
  return store;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  openPanel.mockClear();
  vi.restoreAllMocks();
});

describe.each(reactivityPorts)('the chat store, under %s', (_name, makePort) => {
  beforeEach(() => {
    port = makePort();
    platform = createTestPlatform();
  });

  describe('opening a chat', () => {
    it('opens nothing for a space ask whose dataset is not known yet', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = withStore();
      store.openChat({ datasetId: undefined, spaceName: 'Garden', draft: 'what is here?' });
      store.openChat({ datasetId: '', spaceName: 'Garden', draft: 'what is here?' });
      expect(openPanel).not.toHaveBeenCalled();
      expect(store.sheet()).toBeNull();
    });

    it('opens the space chat for a space ask with its dataset', () => {
      const store = withStore();
      store.openChat({ datasetId: '61d5c775-9cdf-4cbe-aa23-19ed212b108b', spaceName: 'Garden' });
      expect(openPanel).toHaveBeenCalledWith(
        'chat-space',
        expect.objectContaining({ datasetId: '61d5c775-9cdf-4cbe-aa23-19ed212b108b' }),
        expect.objectContaining({ key: '61d5c775-9cdf-4cbe-aa23-19ed212b108b' }),
      );
    });

    it('opens the global chat when no dataset was named at all', () => {
      const store = withStore();
      store.openChat();
      expect(openPanel).toHaveBeenCalledWith(
        'chat-global',
        expect.anything(),
        expect.objectContaining({ key: 'global' }),
      );
    });

    it('travels a question as a nonce, never as inputs — spent once, gone after', () => {
      const store = withStore();
      store.openChat({ datasetId: 'uuid-9', draft: 'what is here?' });

      // What the panel is told: the nonce, and nothing a reader could send itself.
      const inputs = openPanel.mock.calls[0][1] as Record<string, unknown>;
      expect(inputs.draft).toBeUndefined();
      expect(inputs.at).toBeUndefined();
      const nonce = inputs.nonce as string;
      expect(nonce).toBeTruthy();

      // The question waits in the store, bound to the scope it was asked in — spent once.
      expect(store.takePending(nonce)).toEqual({ text: 'what is here?', datasetId: 'uuid-9' });
      expect(store.takePending(nonce)).toBeUndefined();
    });

    it('answers nothing for a nonce nobody issued', () => {
      const store = withStore();
      // The shape a template would forge — there is no map entry for it to find.
      expect(store.takePending('forged')).toBeUndefined();
    });
  });

  /*
  Whose records these are changes with the signed-in agent — `SessionStore` hands the store the
  DID the way it hands the shell's kept instances one, and everything kept hangs off it. A logout
  without a reload used to leave the last agent's remembered conversation and pending questions
  where the next sign-in could find them.
*/
  describe('an identity change', () => {
    function withDidStore() {
      const [did, setDid] = port.signal<string | undefined>('did:test:agent-a');
      const store = withStore();
      store.provideAgentDid(() => did());
      return { store, setDid };
    }

    it('drops the remembered conversation and the pending question with the DID', () => {
      const { store, setDid } = withDidStore();

      // A is in mid-conversation, with a question still waiting on its nonce.
      store.rememberConversation('global', { ref: { id: 'conv-a' }, title: 'A’s chat' });
      store.openChat({ draft: 'a question only A asked' });
      const nonce = (openPanel.mock.calls.at(-1)![1] as Record<string, unknown>).nonce as string;
      expect(nonce).toBeTruthy();
      expect(store.rememberedConversation('global')).toEqual({ ref: { id: 'conv-a' }, title: 'A’s chat' });

      // Sign-out and another agent in, without the reload that used to hide the hand-off.
      setDid(undefined);
      setDid('did:test:agent-b');

      // B's chat opens on its list — nothing of A's remembered, and A's nonce answers nothing.
      expect(store.rememberedConversation('global')).toBeUndefined();
      expect(store.takePending(nonce)).toBeUndefined();

      // B's own record works — the maps did not die with A's.
      store.rememberConversation('global', { ref: { id: 'conv-b' }, title: 'B’s chat' });
      store.openChat({ draft: 'b’s question' });
      const bNonce = (openPanel.mock.calls.at(-1)![1] as Record<string, unknown>).nonce as string;
      expect(store.rememberedConversation('global')).toEqual({ ref: { id: 'conv-b' }, title: 'B’s chat' });
      expect(store.takePending(bNonce)).toEqual({ text: 'b’s question', datasetId: undefined });

      // Nor does A's state come back if A signs in again — it was dropped, not hidden.
      setDid('did:test:agent-a');
      expect(store.rememberedConversation('global')).toBeUndefined();
      expect(store.takePending(nonce)).toBeUndefined();
    });
  });

  describe('a narrow window', () => {
    it('opens a sheet over the space instead of a panel, and follows the width as it changes', () => {
      const store = withStore();
      const narrow: boolean[] = [];
      disposers.push(port.root(() => port.effect(() => void narrow.push(store.isNarrow()))));

      platform.resize({ width: NARROW_VIEWPORT_PX - 1, height: 900 });
      expect(store.isNarrow()).toBe(true);
      const seen = narrow.length;
      // A resize that crosses nothing wakes nothing.
      platform.resize({ width: NARROW_VIEWPORT_PX - 2, height: 900 });
      expect(narrow.length).toBe(seen);

      store.openChat({ datasetId: 'uuid-9', spaceName: 'Garden', prefill: 'about' });
      expect(openPanel).not.toHaveBeenCalled();
      expect(store.sheet()).toEqual({ datasetId: 'uuid-9', spaceName: 'Garden', prefill: 'about' });
      store.closeSheet();
      expect(store.sheet()).toBeNull();
    });

    it('stops following the width once its owner is disposed', () => {
      const store = withStore();
      disposers.splice(0).forEach((dispose) => dispose());
      platform.resize({ width: NARROW_VIEWPORT_PX - 1, height: 900 });
      expect(store.isNarrow()).toBe(false);
    });
  });
});
