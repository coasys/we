/**
 * The v0 outcomes view, offline: the Acorn fixture written through `applyFixture` into
 * `@we/backend-inmemory`, the view drawn by the real schema renderer — the same
 * `$query` → QueryIR → row path the app runs, with no executor.
 *
 * S2-3 turns the list into the module's `acorn.outcomeList` part: the view places it with
 * `$part`, which the host's `resolveParts` expands before the renderer sees it. This test
 * does the same expansion inline — the part's node for the placement's id — because the
 * expansion is what the app always does, and an unexpanded `$part` is what the renderer
 * gets only on a deployment missing the module.
 *
 * What it proves: the three fixture contents reach the DOM, the derived status line is
 * there, and the list carries its write affordances (a create box, per-outcome edit
 * fields, tag and delete controls). What it does not prove: a write reaching stock —
 * the live rig suite owns that half (`apps/we-web/tests/live/acorn.live.mjs`).
 */
import { render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import { ACORN_PARTS, acornModule } from '@we/module-acorn';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { acornOutcomesView } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

/** The three outcome contents the fixture writes — the strings the render must surface. */
const FIXTURE_OUTCOMES = [
  'Acorn runs as a WE template',
  'Shell boots on the in-memory backend',
  'Outcome list reads live mounted records',
];

/**
 * What the host's `resolveParts` does for the one module this test places: a `$part`
 * node's id names a part in `acornModule`'s `contributes.parts`, and the part's `node`
 * stands in for it. Structural, recursive — a part may place a part.
 */
function expandParts(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const record = node as SchemaNode;
  if (record.type === '$part') {
    const id = (record.props as { id?: unknown } | undefined)?.id;
    const part = typeof id === 'string' ? ACORN_PARTS[id.split('.')[1]] : undefined;
    if (!part) throw new Error(`$part "${String(id)}" names no acorn part`);
    return expandParts(part.node);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'children' && Array.isArray(value)) out[key] = value.map(expandParts);
    else out[key] = value;
  }
  return out;
}

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

// `Column`/`Row` are layer-4 components the app registry supplies; the view and the part
// use them only for layout, so the test's registry renders their children straight
// through. `we-*` tags mount as custom elements without a registry entry — in jsdom
// they draw their light-DOM children, which is what the assertions read.
const Passthrough = (props: { children?: JSX.Element }) => props.children;
const registry = { Column: Passthrough, Row: Passthrough };

describe('the acorn outcomes view, v0', () => {
  it('outcome list renders fixture contents', async () => {
    const { stores, errors } = await fixtureHost();
    const { container, unmount } = render(() => (
      <RenderSchema
        node={expandParts(acornOutcomesView) as SchemaNode}
        stores={stores as never}
        registry={registry}
        context={{}}
      />
    ));
    try {
      for (const content of FIXTURE_OUTCOMES) {
        await waitFor(() => expect(container.textContent).toContain(content));
      }
      // And through the module's own functions, not only raw fields: the achieved
      // outcome's status label and its task progress are derived, not stored.
      await waitFor(() => expect(container.textContent).toContain('Achieved'));
      await waitFor(() => expect(container.textContent).toContain('1/1'));
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('the list is writable: a create box and per-outcome edit/tag/delete controls', async () => {
    const { stores } = await fixtureHost();
    const { container, unmount } = render(() => (
      <RenderSchema
        node={expandParts(acornOutcomesView) as SchemaNode}
        stores={stores as never}
        registry={registry}
        context={{}}
      />
    ));
    try {
      await waitFor(() => expect(container.querySelectorAll('we-input').length).toBeGreaterThan(0));
      const buttons = [...container.querySelectorAll('we-button')].map((b) => b.textContent ?? '');
      expect(buttons.some((label) => label.includes('Add outcome'))).toBe(true);
      expect(buttons.some((label) => label.includes('Delete'))).toBe(true);
      // One editable field per outcome per field family — content and notes/empty-clear.
      // Three fixture outcomes → at least three `we-input`s beyond the create box.
      expect(container.querySelectorAll('we-input').length).toBeGreaterThanOrEqual(1 + FIXTURE_OUTCOMES.length * 2);
    } finally {
      unmount();
    }
  });
});
