/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Acorn projects modal's own state machine — `acornProjectsModalMount` through
 * the real renderer. A mount that cannot finish is a *shown, resumable* failure:
 * the retained operation lives in `spaceStore.acornPending`, the dialog reports
 * it and offers Retry on that same target — and a call that resolves `null`
 * (superseded, unsupported, stood down) is not a landing the modal may close on.
 *
 * The primitives are left un-upgraded — jsdom cannot adopt their stylesheets — so
 * each `we-button` is a plain element whose `disabled`/`loading` props land as
 * properties, and pressing it is a real `click()` the delegated handler hears.
 */
import type { AcornOperationState } from '@shared/acornLifecycle';
import { cleanup, render } from '@solidjs/testing-library';
import { REACTIVE_ACCESSOR } from '@we/schema-shared';
import type { ComponentRegistry } from '@we/schema-solid';
import { RenderSchema } from '@we/schema-solid';
import { acornProjectsModalMount } from '@we/template-shell';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Accessors the real stores answer with — expressions call only tagged members. */
const accessor = <T,>(read: () => T): (() => T) => Object.assign(read, { [REACTIVE_ACCESSOR]: true });

const registry: ComponentRegistry = {
  Column: (props: any) => <div>{props.children}</div>,
  Row: (props: any) => <div>{props.children}</div>,
};

interface FakeStores {
  spaceStore: Record<string, unknown>;
  shellStore: {
    acornProjectsOpen: () => boolean;
    setAcornProjectsOpen: ReturnType<typeof vi.fn>;
  };
}

function fakeStores(overrides: Record<string, unknown> = {}) {
  const [open, setOpen] = createSignal(true);
  const [pending, setPending] = createSignal<AcornOperationState | null>(null);
  const stores: FakeStores & { setPending: (s: AcornOperationState | null) => void } = {
    spaceStore: {
      acornAvailable: accessor(() => true),
      acornProjects: accessor(() => []),
      acornPending: accessor(pending),
      createAcornProject: vi.fn(async () => 'dataset-1'),
      joinAcornProject: vi.fn(async () => 'dataset-1'),
      openAcornProject: vi.fn(async () => 'dataset-1'),
      retryAcornProject: vi.fn(async () => 'dataset-1'),
      ...overrides,
    },
    shellStore: {
      acornProjectsOpen: accessor(open),
      setAcornProjectsOpen: vi.fn((v: boolean) => setOpen(v)),
    },
    setPending,
  };
  return stores;
}

/** The one `we-*` whose text carries `label`. */
function button(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll('we-button')].find((el) => el.textContent?.trim() === label);
  if (!found) throw new Error(`no "${label}" button in ${container.innerHTML}`);
  return found as HTMLElement;
}

/** Type into the first `we-input` the way the primitive reports it. */
function type(container: HTMLElement, value: string, index = 0) {
  container
    .querySelectorAll('we-input')
    [index].dispatchEvent(new CustomEvent('input', { detail: value, bubbles: true, composed: true }));
}

/** Everything `we-alert` is carrying — empty when none is mounted. */
const alertText = (container: HTMLElement) =>
  [...container.querySelectorAll('we-alert')].map((el) => el.textContent).join(' ');

afterEach(cleanup);

describe('the Acorn projects dialog', () => {
  it('closes only on a landed project — a null answer is not a success to close on', async () => {
    const stores = fakeStores({ createAcornProject: vi.fn(async () => null) });
    const { container } = render(() => (
      <RenderSchema node={acornProjectsModalMount} stores={stores as never} registry={registry} />
    ));

    type(container, 'Project', 0);
    type(container, 'a b c', 1);
    button(container, 'Create project').click();
    await vi.waitFor(() => expect(stores.spaceStore.createAcornProject).toHaveBeenCalledWith('Project', 'a b c'));

    // Null — superseded or unsupported — keeps the dialog open and says so, rather
    // than landing the person on nothing while calling it a project.
    await vi.waitFor(() => expect(alertText(container)).not.toBe(''));
    expect(stores.shellStore.setAcornProjectsOpen).not.toHaveBeenCalled();
  });

  it('shows the retained operation while it mounts — spinner, phase and attempt', async () => {
    const stores = fakeStores();
    const { container } = render(() => (
      <RenderSchema node={acornProjectsModalMount} stores={stores as never} registry={registry} />
    ));

    stores.setPending({
      phase: 'mounting',
      name: 'Rig Project',
      datasetId: 'ds-1',
      languageAddress: 'QmL',
      attempt: 2,
    });
    await vi.waitFor(() => {
      expect(container.querySelector('we-animated-icon')).not.toBeNull();
      expect(container.textContent).toContain('attempt');
      expect(container.textContent).toContain('2');
    });
  });

  it('shows a resumable failure — cause, Retry on the same target, Close that dismisses', async () => {
    const stores = fakeStores();
    const { container } = render(() => (
      <RenderSchema node={acornProjectsModalMount} stores={stores as never} registry={registry} />
    ));

    stores.setPending({
      phase: 'failed',
      name: 'Rig Project',
      datasetId: 'ds-1',
      languageAddress: 'QmL',
      failure: { stage: 'mount', cause: 'ConductorApiError: CellError(InitTimeout)', retryable: true },
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('could not finish connecting');
      expect(alertText(container)).toContain('InitTimeout');
    });

    // Retry resumes the retained target — no form values travel with it. An
    // unanswered (null) retry keeps the dialog open — the failure is still showing.
    (stores.spaceStore.retryAcornProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    button(container, 'Retry').click();
    await vi.waitFor(() => expect(stores.spaceStore.retryAcornProject).toHaveBeenCalledTimes(1));
    expect(stores.spaceStore.createAcornProject).not.toHaveBeenCalled();
    expect(stores.shellStore.setAcornProjectsOpen).not.toHaveBeenCalled();

    // Close dismisses without claiming success — once the retry's finally has
    // cleared the busy flag that disables it while a call is out.
    await vi.waitFor(() => expect((button(container, 'Close') as any).disabled).toBe(false));
    button(container, 'Close').click();
    expect(stores.shellStore.setAcornProjectsOpen).toHaveBeenCalledWith(false);
  });

  it('closes when the retry lands — a landed project is the success the dialog closes on', async () => {
    const stores = fakeStores();
    const { container } = render(() => (
      <RenderSchema node={acornProjectsModalMount} stores={stores as never} registry={registry} />
    ));

    stores.setPending({
      phase: 'failed',
      name: 'Rig Project',
      datasetId: 'ds-1',
      languageAddress: 'QmL',
      failure: { stage: 'mount', cause: 'CellError(InitTimeout)', retryable: true },
    });
    await vi.waitFor(() => button(container, 'Retry'));

    button(container, 'Retry').click();
    await vi.waitFor(() => expect(stores.shellStore.setAcornProjectsOpen).toHaveBeenCalledWith(false));
  });

  it('shows a permanent failure without offering Retry', async () => {
    const stores = fakeStores();
    const { container } = render(() => (
      <RenderSchema node={acornProjectsModalMount} stores={stores as never} registry={registry} />
    ));

    stores.setPending({
      phase: 'failed',
      name: 'Rig Project',
      datasetId: 'ds-1',
      languageAddress: 'QmL',
      failure: { stage: 'mount', cause: 'the language is owned by another schema mirror', retryable: false },
    });

    await vi.waitFor(() => expect(alertText(container)).toContain('schema mirror'));
    expect([...container.querySelectorAll('we-button')].some((el) => el.textContent?.trim() === 'Retry')).toBe(false);
    // Close still dismisses it.
    button(container, 'Close').click();
    expect(stores.shellStore.setAcornProjectsOpen).toHaveBeenCalledWith(false);
  });

  it('clears the busy flag in every finally — a rejected call re-enables the form', async () => {
    let release!: (e: Error) => void;
    const stores = fakeStores({
      createAcornProject: vi.fn(() => new Promise<string | null>((_r, reject) => (release = reject))),
    });
    const { container } = render(() => (
      <RenderSchema node={acornProjectsModalMount} stores={stores as never} registry={registry} />
    ));

    type(container, 'Project', 0);
    type(container, 'a b c', 1);
    const create = button(container, 'Create project');
    create.click();
    await vi.waitFor(() => expect((create as any).loading).toBe(true));
    expect((create as any).disabled).toBe(true); // single-flight while the call is out

    release(new Error('socket closed'));
    await vi.waitFor(() => expect((create as any).loading).toBe(false));
    expect((create as any).disabled).toBe(false);
    expect(alertText(container)).toContain('socket closed');
    expect(stores.shellStore.setAcornProjectsOpen).not.toHaveBeenCalled();
  });
});
