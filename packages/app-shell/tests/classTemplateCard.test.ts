/**
 * A class becomes one canvas card, or it becomes nothing.
 *
 * The card is made through the write `RecordStore.createCardOnCanvas` already uses
 * (`packages/app-shell/src/frameworks/solid/stores/RecordStore.tsx`): one group, the card and its
 * placement, or neither. The class is chosen by `resolveClassOnSurface`. A miss writes nothing —
 * not a card that is filled in afterwards. The class IRI and the template id are different fields,
 * and neither is the card's id.
 *
 * The rig stands in for that write group. It can stage a card and then fail, which is the partial
 * the cleanup has to remove. Published templates are not consulted.
 */
import { reserveId } from '@shared/templateIdentity';
import { describe, expect, it, vi } from 'vitest';

import { CLASS_SURFACE_FIXTURE, isValidTemplateId } from '../src/shared/registries/templateRegistry';
import {
  type CanvasCardCreation,
  type CanvasCardWrite,
  type ClassSurfaceBinding,
  createClassTemplateCard,
} from '../src/shared/registries/templateSurface';

const FIXTURE = CLASS_SURFACE_FIXTURE[0];

interface Rig {
  staged: CanvasCardWrite[];
  committed: CanvasCardWrite[];
  removed: string[];
  creation: CanvasCardCreation;
  creates: () => number;
  fail: (next: boolean) => void;
}

function makeRig(): Rig {
  const staged: CanvasCardWrite[] = [];
  const committed: CanvasCardWrite[] = [];
  const removed: string[] = [];
  let creates = 0;
  let fail = false;
  const creation: CanvasCardCreation = {
    async create(card) {
      creates += 1;
      // Visible before the group commits. A throw below leaves this partial behind on purpose.
      staged.push(card);
      if (fail) throw new Error('placement failed');
      committed.push(card);
      staged.splice(
        staged.findIndex((row) => row.id === card.id),
        1,
      );
    },
    async remove(id) {
      removed.push(id);
      const drop = (rows: CanvasCardWrite[]) => {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      };
      drop(staged);
      drop(committed);
    },
  };
  return {
    staged,
    committed,
    removed,
    creation,
    creates: () => creates,
    fail: (next) => {
      fail = next;
    },
  };
}

function request(classIri: string, surface: string = FIXTURE.surface) {
  return { classIri, surface, canvas: 'canvas-1' };
}

describe('instantiating a card from its class template', () => {
  it('a class without a matching surface template creates no partial card', async () => {
    const rig = makeRig();
    const missing = await createClassTemplateCard(
      request('we://NotInTheFixture'),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      rig.creation,
    );
    expect(missing).toEqual({
      status: 'no-template',
      classIri: 'we://NotInTheFixture',
      surface: 'card',
    });

    // The fixture's display name, on a different class. Not a fallback.
    const twin = await createClassTemplateCard(
      request('flux://Topic'),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      rig.creation,
    );
    expect(twin).toEqual({ status: 'no-template', classIri: 'flux://Topic', surface: 'card' });

    // Bound, but on a surface this fixture does not name.
    const otherSurface = await createClassTemplateCard(
      request(FIXTURE.classIri, 'detail'),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      rig.creation,
    );
    expect(otherSurface.status).toBe('no-template');

    // The template id is a display name. The caller does not know it.
    const labelled: ClassSurfaceBinding = { ...FIXTURE, templateId: 'Acorn' };
    const unknown = await createClassTemplateCard(
      request(FIXTURE.classIri),
      [labelled],
      isValidTemplateId,
      rig.creation,
    );
    expect(unknown.status).toBe('no-template');

    // Two bindings, two template ids. The resolver refuses, and so does creation.
    const again: ClassSurfaceBinding = { ...FIXTURE, templateId: 'workshop' };
    const disagreed = await createClassTemplateCard(
      request(FIXTURE.classIri),
      [FIXTURE, again],
      (id) => id === FIXTURE.templateId || id === 'workshop',
      rig.creation,
    );
    expect(disagreed.status).toBe('no-template');

    expect(rig.creates()).toBe(0);
    expect(rig.removed).toEqual([]);
    expect(rig.staged).toEqual([]);
    expect(rig.committed).toEqual([]);
  });

  it('a valid binding creates exactly one card with the class IRI', async () => {
    const rig = makeRig();
    const result = await createClassTemplateCard(
      { ...request(FIXTURE.classIri), at: { x: 3, y: 4 } },
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      rig.creation,
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(rig.committed).toHaveLength(1);
    expect(rig.staged).toEqual([]);
    expect(rig.creates()).toBe(1);
    expect(result.card.classIri).toBe(FIXTURE.classIri);
    expect(rig.committed[0]).toMatchObject({
      id: result.card.id,
      classIri: FIXTURE.classIri,
      templateId: FIXTURE.templateId,
      surface: 'card',
      canvas: 'canvas-1',
      kind: 'card',
      at: { x: 3, y: 4 },
    });
  });

  it('keeps class data separate from template identity', async () => {
    const topic: ClassSurfaceBinding = {
      classIri: 'we://Topic',
      displayName: 'Topic',
      surface: 'card',
      templateId: 'acorn',
    };
    const fluxTopic: ClassSurfaceBinding = {
      classIri: 'flux://Topic',
      displayName: 'Topic',
      surface: 'card',
      templateId: 'workshop',
    };
    const known = (id: string) => id === 'acorn' || id === 'workshop';
    const rig = makeRig();
    const result = await createClassTemplateCard(request(topic.classIri), [topic, fluxTopic], known, rig.creation);

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.card.classIri).toBe('we://Topic');
    expect(result.card.templateId).toBe('acorn');
    expect(result.card.classIri).not.toBe(result.card.templateId);
    expect(result.card.id).not.toBe(result.card.templateId);
    expect(result.card.id).not.toBe(result.card.classIri);
    // The same rule a stored template uses: an id a built-in holds is rewritten, and the card's id has that shape.
    const rewritten = reserveId(result.card.templateId, [result.card.templateId]);
    expect(rewritten).not.toBe(result.card.templateId);
    expect(rewritten.startsWith(`${result.card.templateId}-`)).toBe(true);
    expect(result.card.id.startsWith(`${result.card.templateId}-`)).toBe(true);
    expect(result.card.templateId).not.toBe(fluxTopic.templateId);
    // The display name is not stored. The IRI may contain the same word; that is still the class, not the label.
    expect(rig.committed[0]).not.toHaveProperty('displayName');
    expect(result.card.classIri).not.toBe(topic.displayName);
    expect(result.card.templateId).not.toBe(topic.displayName);
    expect(rig.committed).toHaveLength(1);
  });

  it('a double submission creates one card', async () => {
    const rig = makeRig();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const creation: CanvasCardCreation = {
      async create(card) {
        entered += 1;
        await gate;
        rig.committed.push(card);
      },
      async remove(id) {
        rig.removed.push(id);
      },
    };

    const pending = Promise.all([
      createClassTemplateCard(request(FIXTURE.classIri), CLASS_SURFACE_FIXTURE, isValidTemplateId, creation),
      createClassTemplateCard(request(FIXTURE.classIri), CLASS_SURFACE_FIXTURE, isValidTemplateId, creation),
    ]);
    await vi.waitFor(() => {
      expect(entered).toBe(1);
    });
    release();
    const [first, second] = await pending;

    expect(entered).toBe(1);
    expect(first).toEqual(second);
    expect(first.status).toBe('created');
    expect(rig.committed).toHaveLength(1);
    if (first.status === 'created') expect(rig.committed[0].classIri).toBe(FIXTURE.classIri);
  });

  it('a failed create leaves no card', async () => {
    const rig = makeRig();
    rig.fail(true);
    await expect(
      createClassTemplateCard(request(FIXTURE.classIri), CLASS_SURFACE_FIXTURE, isValidTemplateId, rig.creation),
    ).rejects.toThrow('placement failed');

    expect(rig.creates()).toBe(1);
    expect(rig.staged).toEqual([]);
    expect(rig.committed).toEqual([]);
    expect(rig.removed).toHaveLength(1);

    // The failed attempt does not stick. A later submission still creates the one card.
    rig.fail(false);
    const again = await createClassTemplateCard(
      request(FIXTURE.classIri),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      rig.creation,
    );
    expect(again.status).toBe('created');
    expect(rig.committed).toHaveLength(1);
    expect(rig.staged).toEqual([]);
    if (again.status === 'created') expect(rig.committed[0].classIri).toBe(FIXTURE.classIri);
  });
});
