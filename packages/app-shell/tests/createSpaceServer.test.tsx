/**
 * Choosing the link server a new shared space syncs through, in the create-space modal.
 *
 * Driven through the real modal schema and renderer, because what can go wrong is in the schema:
 * which value reaches `createSpace`, and whether a custom address the store would refuse is stopped
 * beside its field rather than after the modal has closed. The primitives are left un-upgraded, as
 * in `credentialField.test.tsx`, so the test dispatches each one's own events.
 */
import { componentRegistry } from '@solid/registries/componentRegistry';
import { cleanup, render } from '@solidjs/testing-library';
import { RenderSchema } from '@we/schema-solid';
import { createSpaceModal } from '@we/template-shell';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sharingPickerOptions } from '../src/shared/sharingOptions';

const PRODUCTION = 'https://link.ad4m.dev';
const STAGING = 'https://link-staging.ad4m.dev';

const OPTIONS = sharingPickerOptions([
  { id: 'Qm-p2p', name: 'perspectiveDiffSync', kind: 'peer-to-peer' },
  { id: 'Qm-server', name: 'server-link-language', kind: 'server', servers: [PRODUCTION, STAGING] },
]);

function renderModal() {
  const createSpace = vi.fn(async (..._args: unknown[]) => {});
  // Store members as a template reads them: values, not the accessors the providers hold.
  const stores = {
    spaceStore: { sharingOptions: OPTIONS, defaultSharing: 'Qm-p2p', createSpace },
    shellStore: { setCreateSpaceOpen: vi.fn() },
    datasetStore: { globalDataset: null, globalSpaceConfigured: false },
    templateStore: { brand: { name: 'WE' } },
  };
  const { container } = render(() => (
    <RenderSchema node={createSpaceModal as never} stores={stores} registry={componentRegistry as never} />
  ));
  return { container, createSpace };
}

const fire = (el: Element, type: string, detail?: unknown) =>
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

/** The `we-select` whose label is `label`. */
const select = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('we-select')].find((el) => (el as unknown as { label: string }).label === label);

const createButton = (container: HTMLElement) =>
  [...container.querySelectorAll('we-button')].find(
    (el) => (el as unknown as { text: string }).text === 'Create Space',
  )!;

/** Fill in a name, make the space shared and choose the server option. */
function shareThroughServer(container: HTMLElement) {
  fire(container.querySelector('we-input')!, 'input', 'Garden');
  fire(container.querySelector('we-switch')!, 'change', true);
  fire(select(container, 'How this space syncs')!, 'change', 'Qm-server');
}

/** The custom address field — the `we-input` with the URL type. */
const customInput = (container: HTMLElement) =>
  [...container.querySelectorAll('we-input')].find((el) => (el as unknown as { type: string }).type === 'url');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(cleanup);

describe('the link server of a new shared space', () => {
  it('is not asked about for a peer-to-peer space', () => {
    const { container } = renderModal();
    fire(container.querySelector('we-switch')!, 'change', true);

    expect(select(container, 'How this space syncs')).toBeDefined();
    expect(select(container, 'Link server')).toBeUndefined();
  });

  it('offers the backend’s servers, default first and shown as chosen, then a custom one', () => {
    const { container } = renderModal();
    shareThroughServer(container);

    const servers = select(container, 'Link server') as unknown as { value: string; options: { value: string }[] };
    expect(servers.options.map((o) => o.value)).toEqual([PRODUCTION, STAGING, 'custom']);
    expect(servers.value).toBe(PRODUCTION);
    expect(customInput(container)).toBeUndefined();
  });

  it.each([
    ['the default, left as it is', undefined, undefined, ''],
    ['staging', STAGING, undefined, STAGING],
    ['a custom server', 'custom', 'https://links.example.org:8443', 'https://links.example.org:8443'],
  ])('passes %s to createSpace', async (_name, choice, typed, expected) => {
    const { container, createSpace } = renderModal();
    shareThroughServer(container);
    if (choice) fire(select(container, 'Link server')!, 'change', choice);
    if (typed) fire(customInput(container)!, 'input', typed);

    fire(createButton(container), 'click');
    await settle();

    expect(createSpace).toHaveBeenCalledTimes(1);
    expect(createSpace.mock.calls[0][7]).toBe('Qm-server');
    expect(createSpace.mock.calls[0][8]).toBe(expected);
  });

  it.each(['link.example.org', 'ftp://link.example.org', 'https://', ''])(
    'refuses %j as a custom server beside its field, creating nothing',
    async (typed) => {
      const { container, createSpace } = renderModal();
      shareThroughServer(container);
      fire(select(container, 'Link server')!, 'change', 'custom');
      fire(customInput(container)!, 'input', typed);

      fire(createButton(container), 'click');
      await settle();

      expect(createSpace).not.toHaveBeenCalled();
      const field = customInput(container)!.closest('we-form-field') as unknown as { error: string };
      expect(field.error).toMatch(/https:\/\/ or http:\/\/|Enter the server’s address/);
    },
  );

  it('forgets a bad custom server once the space is made personal, so it cannot block creating one', async () => {
    const { container, createSpace } = renderModal();
    shareThroughServer(container);
    fire(select(container, 'Link server')!, 'change', 'custom');
    fire(customInput(container)!, 'input', 'not a url');
    fire(container.querySelector('we-switch')!, 'change', false);

    fire(createButton(container), 'click');
    await settle();

    expect(createSpace).toHaveBeenCalledTimes(1);
    expect(createSpace.mock.calls[0][2]).toBe('personal');
    expect(createSpace.mock.calls[0][8]).toBe('');
  });
});
