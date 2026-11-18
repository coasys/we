/**
 * The offline render the whole scaffold exists for: the Acorn fixture, written through
 * `applyFixture` into `@we/backend-inmemory`, drawn by the v0 template views through the real
 * schema renderer — the same `$query` → QueryIR → row path the app runs, with no executor.
 *
 * What it proves and what it does not: the three fixture outcome contents reach the DOM, which
 * means the fixture writes, the shapes adopt, the query resolves and the view renders. It is not
 * a mount test — nothing here stands up an AD4M perspective, and S2-2 owns that half.
 */
import { render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, acornFixture, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { RenderSchema } from '@we/schema-solid';
import { ACORN_VIEWS, acornOutcomesView } from '@we/template-acorn';
import type { JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

/** The three outcome contents the fixture writes — the strings the render must surface. */
const FIXTURE_OUTCOMES = [
  'Acorn runs as a WE template',
  'Shell boots on the in-memory backend',
  'Outcome list reads live mounted records',
];

async function fixtureHost() {
  const ports = createInMemoryBackendPorts(
    { selfId: () => SELF },
    { datasets: [{ id: acornDatasetId, name: 'Acorn fixture' }] },
  );
  await applyAcornFixture(ports);
  const dataset = await ports.lifecycle.get(acornDatasetId);
  if (!dataset) throw new Error('fixture dataset missing after apply');

  const bindings = ports.dataBindings({
    currentDataset: () => dataset.handle,
    currentDatasetEntities: () => manifestEntries(ACORN_MANIFEST),
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: ports.ephemeral,
  });

  // The module's contributed functions, installed the way TemplateProvider installs
  // `moduleRegistry.functions()` — the host's `$sources`, keyed by call name.
  const $sources: Record<string, (options: unknown) => unknown> = {};
  for (const fn of acornModule.contributes?.functions ?? []) {
    $sources[fn.name] = fn.fn as (options: unknown) => unknown;
  }

  const errors: string[] = [];
  const stores = {
    ...bindings,
    $sources,
    $onError: (message: string) => errors.push(message),
    $modelsPending: () => false,
  };
  return { ports, dataset, stores, errors };
}

// `Column`/`Row` are layer-4 components the app registry supplies; the views use them only for
// layout, so the test's registry renders their children straight through. `we-*` tags mount as
// custom elements without a registry entry.
const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

describe('the acorn fixture, rendered', () => {
  it('writes the dataset the space declares — acorn template, acorn module, its five sections', async () => {
    const { dataset } = await fixtureHost();
    const spaces = await getEntity('Space').findAll(dataset.handle, {});
    expect(spaces).toHaveLength(1);
    expect(spaces[0].defaultTemplateId).toBe(acornFixture.templateId);
    expect(spaces[0].defaultTemplateId).toBe('acorn');
    // The declared default: the sections the space turns on, first of which is where a member
    // lands — the outcomes list. The same list the template package catalogues, in the same order.
    const enabled = JSON.parse(spaces[0].enabledViews as string) as string[];
    expect(enabled).toEqual(Object.keys(ACORN_VIEWS));
    expect(enabled[0]).toBe('acorn-outcomes');
    const modules = JSON.parse(spaces[0].enabledModules as string) as string[];
    expect(modules).toEqual(['acorn']);
  });

  it('renders the outcomes view: all three fixture outcome contents appear', async () => {
    const { stores, errors } = await fixtureHost();
    const { container, unmount } = render(() => (
      <RenderSchema node={acornOutcomesView} stores={stores as never} registry={registry} context={{}} />
    ));
    try {
      for (const content of FIXTURE_OUTCOMES) {
        await waitFor(() => expect(container.textContent).toContain(content));
      }
      // And through the module's own functions, not only raw fields: the achieved outcome's
      // status label and its task progress are derived, not stored.
      await waitFor(() => expect(container.textContent).toContain('Achieved'));
      await waitFor(() => expect(container.textContent).toContain('1/1'));
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('every catalogued view carries meta.role: view — the marker expands only sections', () => {
    for (const [id, view] of Object.entries(ACORN_VIEWS)) {
      expect(view.meta?.role, `view "${id}" is not marked meta.role: 'view'`).toBe('view');
      expect(view.meta?.segment, `view "${id}" names no segment`).toBeTruthy();
    }
  });
});
