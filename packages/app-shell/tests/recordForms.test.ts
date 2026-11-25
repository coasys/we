/**
 * The record store's forms part on its own: a draft opened on a model and typed into in place, a save
 * refused for what is missing and made as one write when it is not, a form aimed at a canvas placing
 * what it makes, and a drawn line opening the connection form.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecordCanvas } from '../src/shared/stores/records/canvas';
import { createRecordConnections } from '../src/shared/stores/records/connections';
import { canvasChildren, operationRunner } from '../src/shared/stores/records/context';
import { createRecordForms, type RecordForms } from '../src/shared/stores/records/forms';
import { createRecordKinds } from '../src/shared/stores/records/kinds';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const CANVAS = 'canvas-1';
type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let handle: unknown;
  let said: string[];

  function build(): RecordForms {
    const sessionStore = { me: () => ({ did: 'did:key:z6Mk' }) } as never;
    let forms!: RecordForms;
    disposers.push(
      reactivity.root(() => {
        const context = {
          reactivity,
          toasts: {
            info: () => 0,
            success: (m: string) => said.push(m),
            warning: () => 0,
            error: (m: string) => said.push(m),
          },
          sessionStore,
          datasetStore: {
            currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
            currentDatasetEntities: () => [],
            datasets: () => [],
          } as never,
          runOp: operationRunner(sessionStore),
        };
        const kinds = createRecordKinds({ ...context, shapeStore: { spaceShapes: () => [] } });
        const connections = createRecordConnections({ ...context, kinds });
        const canvas = createRecordCanvas({ ...context, connections, contentHome: (c) => c });
        forms = createRecordForms({ ...context, kinds, connections, canvas, contentHome: (c) => c });
      }),
    );
    return forms;
  }

  const field = (forms: RecordForms, name: string) => forms.recordDraft()!.fields.find((f) => f.name === name)!;

  beforeEach(async () => {
    reactivity = makePort();
    said = [];
    const ports = createInMemoryBackendPorts(
      { selfId: () => 'did:key:z6Mk' },
      { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-forms', name: 'Forms' }] },
    );
    handle = (await ports.lifecycle.get('ds-forms'))!.handle;
    await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('opens on a model, and counts typing in place as worth keeping', () => {
    const forms = build();
    forms.openRecordForm('TaskBlock');
    const draft = forms.recordDraft();
    expect(draft?.entity).toBe('TaskBlock');
    expect(forms.recordDraftDirty()).toBe(false);
    forms.setRecordField('title', 'Write the guide');
    // The same draft, written into — so the row being typed in keeps its focus.
    expect(forms.recordDraft()).toBe(draft);
    expect(forms.recordDraftDirty()).toBe(true);
  });

  it('refuses a name that is not a model here, and one written in the composer', () => {
    const forms = build();
    forms.openRecordForm('Nothing');
    forms.setRecordEntity('CollectionBlock');
    expect(said[0]).toBe('No model named "Nothing" in this space.');
    expect(said[1]).toMatch(/written in the composer/);
  });

  it('says what is missing, and makes the record as one write when nothing is', async () => {
    const forms = build();
    forms.openRecordForm('TaskBlock');
    await forms.saveRecord();
    expect(forms.recordErrors().length).toBeGreaterThan(0);

    forms.setRecordField('title', 'Write the guide');
    expect(field(forms, 'title').value).toBe('Write the guide');
    await forms.saveRecord();
    expect(forms.recordDraft()).toBeNull();
    expect(forms.lastCreatedId()).toBeTruthy();
    expect((await model('TaskBlock').findAll(handle)).map((row) => row.title)).toEqual(['Write the guide']);
  });

  it('places what a form aimed at a canvas makes, at the point chosen', async () => {
    const forms = build();
    forms.createOnCanvas(CANVAS, 120, 80);
    forms.setRecordEntity('TaskBlock');
    forms.setRecordField('title', 'Here');
    await forms.saveRecord();
    const rows = await model('Placement').findAll(handle, { parent: canvasChildren(CANVAS) });
    expect(rows.map((row) => [row.x, row.y])).toEqual([[120, 80]]);
  });

  it('opens the connection form on a drawn line, and forgets the line when closed', () => {
    const forms = build();
    forms.connectNodes({ sourceId: 'a', sourceType: 'TaskBlock', targetId: 'b', targetType: 'TaskBlock' });
    expect(forms.recordDraft()?.entity).toBe('Relationship');
    expect(forms.pendingLink()?.sourceId).toBe('a');
    forms.cancelRecordForm();
    expect(forms.pendingLink()).toBeNull();
    forms.openRecordForm('TaskBlock');
    expect(forms.pendingLink()).toBeNull();
  });
});
