/**
 * The record store's forms: the draft of one record being made — of whatever model the space has —
 * the records filled in inline for its relations, and the connection a drawn line is made as.
 *
 * ## Why the draft lives in a store rather than in `$localState`
 *
 * Because the fields come from data. `$localState` names are fixed when a template is written, so a
 * form over a model chosen at runtime has no names to declare, and no `$setLocal` can address a
 * field nobody knew about. That is the same wall the shape wizard hit, and it is why `shapeDraft`
 * sits in a store too — not a preference about where state goes.
 *
 * A draft is filled in place (`writeFieldValue`) so the control being typed into keeps its row and its
 * focus; a pick that replaces values (a place, an image, a relation) replaces the draft. Nothing is
 * written until the form saves, as one declared operation, inline records included.
 */
import { namePropertyOf } from '@we/backend-shared';
import { compressImageToFileData, dataURIToFileData, inlineRecordId } from '@we/entities';
import type { Accessor } from '@we/reactivity';

import { distinctSignal } from '../../distinctSignal';
import { invokeOperation } from '../../invokeOperation';
import { imagePropertyOf } from '../../shapes/creatableKinds';
import {
  asEntityName,
  creationPath,
  emptyRecordDraft,
  entryLabel,
  placeEntry,
  type RecordDraft,
  recordDraftChanged,
  recordDraftErrors,
  recordDraftFields,
  type RecordField,
  type RecordFieldValue,
  type RelationEntry,
  withoutRelationEntry,
  withPlace,
  withRelationEntry,
  writeFieldValue,
} from '../../shapes/recordDraft';
import type { PendingLink, RecordStore } from '../RecordStore';
import type { RecordCanvas } from './canvas';
import type { RecordConnections } from './connections';
import { type RecordContext, RELATIONSHIP } from './context';
import type { RecordKinds } from './kinds';

export interface RecordFormsDeps extends RecordContext {
  kinds: Pick<RecordKinds, 'creatableEntities' | 'schemaFor' | 'entityClass' | 'relationTarget'>;
  connections: Pick<RecordConnections, 'connect' | 'keyFor'>;
  canvas: Pick<RecordCanvas, 'writePlacement'>;
  /** Where content made on `canvas` lives — see `RecordStore.provideContentHomes`. */
  contentHome: (canvas?: string) => string | undefined;
}

export type RecordForms = Pick<
  RecordStore,
  | 'recordDraft'
  | 'recordDraftDirty'
  | 'recordErrors'
  | 'savingRecord'
  | 'lastCreatedId'
  | 'pendingLink'
  | 'openRecordForm'
  | 'connectNodes'
  | 'connectNodesNow'
  | 'createOnCanvas'
  | 'setRecordEntity'
  | 'setRecordField'
  | 'setRecordPlace'
  | 'relationDraft'
  | 'relationErrors'
  | 'openRelationForm'
  | 'setRelationField'
  | 'saveRelationForm'
  | 'cancelRelationForm'
  | 'pickRelation'
  | 'removeRelationEntry'
  | 'setRelationLocation'
  | 'setRelationEntryField'
  | 'addRelationImage'
  | 'relationshipKind'
  | 'setRelationshipKind'
  | 'cancelRecordForm'
  | 'saveRecord'
>;

export function createRecordForms(deps: RecordFormsDeps): RecordForms {
  const { reactivity, toasts, datasetStore, sessionStore: session, kinds, connections, contentHome } = deps;
  // Named apart from the canvas a form is aimed at, which the save reads as `canvas`.
  const placing = deps.canvas;
  const { creatableEntities, schemaFor, entityClass, relationTarget } = kinds;

  const [recordDraft, setRecordDraft] = distinctSignal<RecordDraft | null>(reactivity, null);
  const [recordErrors, setRecordErrors] = reactivity.signal<string[]>([]);
  /*
    Counts writes into a draft's fields, for whatever has to notice them.

    A field is written in place (see `writeFieldValue`) so the control being typed into keeps its row
    and its focus — which also means the draft signal never changes while somebody types. Anything
    derived from the draft saw the form as it opened: `recordDraftDirty` stayed false through a whole
    paragraph, so closing or going Back threw the work away without asking, while a location pin, which
    replaces the draft, did ask. Reading this beside the draft is what makes the two agree.
  */
  const [draftEdits, setDraftEdits] = reactivity.signal(0);
  const countDraftEdit = () => setDraftEdits(reactivity.untrack(draftEdits) + 1);
  const [savingRecord, setSavingRecord] = distinctSignal(reactivity, false);
  const [lastCreatedId, setLastCreatedId] = distinctSignal(reactivity, '');
  const [pendingLink, setPendingLink] = distinctSignal<PendingLink | null>(reactivity, null);
  const [pendingBoard, setPendingBoard] = distinctSignal(reactivity, '');
  const [relationshipKind, setKind] = distinctSignal(reactivity, '');
  const [pendingPoint, setPendingPoint] = distinctSignal<{ x: number; y: number } | null>(reactivity, null);
  const [relationDraft, setRelationDraft] = distinctSignal<RecordDraft | null>(reactivity, null);
  const [relationFieldName, setRelationFieldName] = distinctSignal(reactivity, '');
  const [relationErrors, setRelationErrors] = reactivity.signal<string[]>([]);
  let entrySeq = 0;

  /*
    `entity` is typed loosely because of how `$invoke` calls a store method.

    A token with no `args` forwards the handler's own arguments, so
    `{ $invoke: 'recordStore.openRecordForm' }` on a button arrives here holding a `PointerEvent`.
    That is right for the common case — it is how `onChange: { $invoke: … }` passes a value through —
    and it means *any* store method with an optional leading parameter can be handed an event by a
    template that was written the obvious way. It surfaced as a toast reading
    `No model named "[object PointerEvent]" in this space`, which at least said what had happened.

    Guarded here as well as at the call site, because the trap belongs to `$invoke` rather than to
    any one template, and there will be more call sites than there are stores.
  */
  function openRecordForm(entity?: unknown): void {
    const named = asEntityName(entity);
    reactivity.batch(() => {
      setRecordErrors([]);
      setRecordDraft(null);
      // A form opened from a button is not a connection, and is not aimed at a canvas, whatever the
      // last one was. Left set, the next ordinary record created would silently be linked to two
      // nodes somebody connected earlier, or land on a canvas they had closed — a wrong write with
      // nothing on screen to suggest it happened.
      setPendingLink(null);
      setPendingBoard('');
      setKind('');
      setPendingPoint(null);
    });
    // Opening on the first model with a form rather than on an empty picker: in a space with one
    // vocabulary that is the only answer, and in a space with several it is still a better start
    // than a form with nothing in it. A composed one has no form to open on.
    const target = named || creatableEntities().find((entity) => entity.via === 'form')?.value;
    if (target) setRecordEntity(target);
  }

  function setRecordEntity(entity: string): void {
    const found = schemaFor(entity);
    if (!found) {
      // Nothing here can render a form for a model this space does not have, and a modal that opens
      // empty is worse than one that says why.
      toasts.error(`No model named "${entity}" in this space.`);
      return;
    }
    // A composed kind has no form to open — a note is written in the composer. Every picker that
    // offers one opens that instead; this is the guard for one that did not.
    if (!found.authorable && creationPath(found.schema) === 'composer') {
      toasts.error(`A ${found.label.toLowerCase()} is written in the composer, not a form.`);
      return;
    }
    reactivity.batch(() => {
      setRecordErrors([]);
      setRecordDraft(
        emptyRecordDraft({
          entity,
          // The model's name as a person reads it — "Location", not `LocationBlock`.
          label: found.label,
          schema: found.schema,
          authorable: found.authorable,
          icon: found.icon,
          relationTarget,
        }),
      );
    });
  }

  /**
   * Write one field's value in place, and deliberately do not touch the signal.
   *
   * `$each` renders rows with Solid's `<For>`, which keys on **object identity**. Replacing the
   * draft on every keystroke made every row a new object, so every control was torn down and
   * rebuilt — and the input being typed into lost focus after a single character.
   *
   * The shape wizard already solved this, and its comment says so: typed fields are mutated without
   * touching the draft signal "so inputs keep focus". An earlier version of this function dismissed
   * that as a cost the wizard paid for reasons that did not apply here, on the grounds that nothing
   * downstream derives from a value. That reasoning was beside the point — `<For>` does not care
   * what a value is *for*, only whether the object holding it is the same one as last time.
   *
   * Nothing has to be published, which is what makes the mutation safe rather than merely expedient:
   * which control a row renders comes from `field.control`, validation runs at save, and the typed
   * text is already in the DOM. The wizard needs `commitDraft` because its rows *do* derive things
   * from what is typed; this one has nothing to keep in step.
   */
  function setRecordField(name: string, value: unknown): void {
    writeInto(recordDraft, name, value);
  }

  function setRecordPlace(detail: unknown): void {
    const current = recordDraft();
    const next = current ? withPlace(current, detail) : null;
    if (next) setRecordDraft(next);
  }

  /**
   * Write a control's value into whichever draft it belongs to.
   *
   * A file control reports a `File` (or a list of one), which is read here into the payload the
   * file-storage language takes — compressed first when it is a picture, as every other upload in
   * WE is. Asynchronous, and written into the draft that is open when it finishes, so a form closed
   * in the meantime is not written into. A file-backed model that also asks for a `name` has it
   * filled from the file when nobody has typed one.
   */
  function writeInto(draft: Accessor<RecordDraft | null>, name: string, value: unknown): void {
    const file: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof File === 'undefined' || !(file instanceof File)) {
      writeFieldValue(draft(), name, value === null || value === undefined ? '' : (value as RecordFieldValue));
      countDraftEdit();
      return;
    }
    const opened = draft();
    void readFile(file)
      .then((payload) => {
        if (draft() !== opened) return;
        writeFieldValue(opened, name, payload);
        countDraftEdit();
        const named = opened?.fields.find((field) => field.name === 'name' && field.control === 'text');
        if (named && typeof named.value === 'string' && !named.value.trim()) named.value = file.name;
      })
      .catch((error) => {
        console.error('RecordStore: reading a file failed', error);
        toasts.error('Could not read that file.');
      });
  }

  async function readFile(file: File): Promise<RecordFieldValue> {
    if (file.type.startsWith('image/')) return compressImageToFileData(file, file.name);
    const uri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      // `readAsDataURL` always yields a string.
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
    return dataURIToFileData(uri, file.name);
  }

  function setRelationLocation(field: string, detail: unknown): void {
    const relation = relationFieldOf(field);
    const found = relation ? schemaFor(relation.target) : undefined;
    const current = recordDraft();
    if (!relation || !found || !current) return;
    const existing = relation.many ? undefined : relation.entries[0];
    const place = placeEntry(found.schema, existing?.fields, detail);
    if (!place) return;
    setRecordDraft(
      withRelationEntry(current, field, {
        key: existing?.key ?? `new-${++entrySeq}`,
        label: place.label,
        entity: relation.target,
        fields: place.fields,
      }),
    );
  }

  /**
   * Edit one field of an entry still to be made — the name under a picked place.
   *
   * In place, as a typed form field is, so the input keeps focus; the chip's label follows the name.
   */
  function setRelationEntryField(field: string, key: string, name: string, value: unknown): void {
    const entry = relationFieldOf(field)?.entries.find((candidate) => candidate.key === key);
    if (!entry?.fields) return;
    entry.fields[name] = value;
    if (name === 'name' && typeof value === 'string' && value.trim()) entry.label = value.trim();
  }

  async function addRelationImage(field: string, file: unknown): Promise<void> {
    const relation = relationFieldOf(field);
    const found = relation ? schemaFor(relation.target) : undefined;
    const property = found ? imagePropertyOf(found.schema) : '';
    const picked: unknown = Array.isArray(file) ? file[0] : file;
    if (!relation || !property || typeof File === 'undefined' || !(picked instanceof File)) return;
    try {
      const payload = (await readFile(picked)) as { data_base64: string; file_type: string; name: string };
      const current = recordDraft();
      if (!current) return;
      setRecordDraft(
        withRelationEntry(current, field, {
          key: `new-${++entrySeq}`,
          label: picked.name,
          entity: relation.target,
          fields: { [property]: payload },
          preview: `data:${payload.file_type};base64,${payload.data_base64}`,
        }),
      );
    } catch (error) {
      console.error('RecordStore: reading an image failed', error);
      toasts.error('Could not read that image.');
    }
  }

  function relationFieldOf(name: string): RecordField | undefined {
    return recordDraft()?.fields.find((field) => field.name === name && field.control === 'relation');
  }

  function openRelationForm(field: string): void {
    const relation = relationFieldOf(field);
    const found = relation ? schemaFor(relation.target) : undefined;
    if (!relation || !found) return;
    reactivity.batch(() => {
      setRelationErrors([]);
      setRelationFieldName(field);
      // No `relationTarget`: a nested form offers no relations of its own. One level is a form
      // inside a form; two is a maze, and nothing a community models needs it to say what it means.
      setRelationDraft(
        emptyRecordDraft({
          entity: relation.target,
          label: relation.targetLabel,
          schema: found.schema,
          authorable: found.authorable,
          icon: found.icon,
        }),
      );
    });
  }

  function setRelationField(name: string, value: unknown): void {
    writeInto(relationDraft, name, value);
  }

  function saveRelationForm(): void {
    const nested = relationDraft();
    const parent = recordDraft();
    if (!nested || !parent) return;
    const errors = recordDraftErrors(nested);
    if (errors.length) {
      setRelationErrors(errors);
      return;
    }
    const found = schemaFor(nested.entity);
    const entry: RelationEntry = {
      key: `new-${++entrySeq}`,
      label: entryLabel(nested, found ? namePropertyOf(found.schema) : '', nested.label),
      entity: nested.entity,
      fields: recordDraftFields(nested),
    };
    reactivity.batch(() => {
      setRecordDraft(withRelationEntry(parent, relationFieldName(), entry));
      setRelationDraft(null);
      setRelationErrors([]);
    });
  }

  function cancelRelationForm(): void {
    reactivity.batch(() => {
      setRelationDraft(null);
      setRelationErrors([]);
    });
  }

  async function pickRelation(field: string, id: unknown): Promise<void> {
    const picked = asEntityName(id);
    const relation = relationFieldOf(field);
    const dataset = datasetStore.currentDataset();
    if (!picked || !relation) return;
    // Named as it is everywhere else, read off the record — a picker's `onChange` carries only the id.
    let label = picked;
    const found = schemaFor(relation.target);
    const nameProperty = found ? namePropertyOf(found.schema) : '';
    if (dataset && nameProperty) {
      try {
        const row = (await entityClass(relation.target, dataset.handle).findOne(dataset.handle, {
          where: { id: picked },
        })) as Record<string, unknown> | null;
        const name = row?.[nameProperty];
        if (typeof name === 'string' && name.trim()) label = name.trim();
      } catch (error) {
        console.warn('RecordStore: could not read the picked record for its name', error);
      }
    }
    const current = recordDraft();
    if (current)
      setRecordDraft(withRelationEntry(current, field, { key: picked, id: picked, label, entity: relation.target }));
  }

  function removeRelationEntry(field: string, key: string): void {
    const current = recordDraft();
    if (current) setRecordDraft(withoutRelationEntry(current, field, key));
  }

  /**
   * A saved record's relations as the create writes them, with the records filled in inline listed
   * to be made in the same write: each relation as a list of ids (a to-one as one), an inline record
   * named by the id the operation will give it (`inlineRecordId`), so the record can point at it
   * before either exists.
   */
  async function relationFields(
    draft: RecordDraft,
    invocationId: string,
  ): Promise<{ relations: Record<string, string[]>; inline: { key: string; entity: string; fields: unknown }[] }> {
    const relations: Record<string, string[]> = {};
    const inline: { key: string; entity: string; fields: unknown }[] = [];
    for (const field of draft.fields) {
      if (field.control !== 'relation' || !field.entries.length) continue;
      const ids: string[] = [];
      for (const [index, entry] of field.entries.entries()) {
        if (entry.id) {
          ids.push(entry.id);
          continue;
        }
        const key = `${field.name}.${index}`;
        inline.push({ key, entity: entry.entity, fields: entry.fields ?? {} });
        ids.push(await inlineRecordId(invocationId, key));
      }
      if (ids.length) relations[field.name] = field.many ? ids : [ids[0]];
    }
    return { relations, inline };
  }

  /** Takes `unknown` for the reason `openRecordForm` does — a picker's event can arrive here. */
  function setRelationshipKind(id: unknown): void {
    setKind(asEntityName(id));
  }

  function connectNodes(link: PendingLink): void {
    if (!link.sourceId || !link.targetId) return;
    reactivity.batch(() => {
      setPendingLink(link);
      setRecordEntity(RELATIONSHIP);
    });
  }

  /**
   * The same connection, written immediately — see the interface for why a template chooses.
   *
   * Deliberately not routed through the draft. A draft exists so a person can fill one in, and
   * mounting one here only to save it unread would put the modal on screen for a frame and make the
   * discard guard reachable with nothing to discard. The write is the two steps `saveRecord` makes
   * for a relationship and no others: the endpoint *types* go in with the fields, because the ORM
   * writes an ordinary property from the create payload, and the endpoints themselves are linked
   * after, because `innerUpdate` skips a relation field holding a plain value — `create(p, { source:
   * uri })` typechecks, runs, and writes no link at all.
   *
   * No canvas parent, and none is needed: the canvas seed asks for connections whose `source` is
   * among the records it has placed, rather than for its own children, so a relationship drawn here
   * is found by the canvas that drew it and by any other showing both ends.
   */
  async function connectNodesNow(link: PendingLink): Promise<string> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !link?.sourceId || !link?.targetId) return '';
    try {
      // Drawn from the moment of the gesture, as every declared operation is — see `connections`.
      const id = await connections.connect(
        dataset.handle,
        { source: link.sourceId, sourceType: link.sourceType, target: link.targetId, targetType: link.targetType },
        {
          key: await connections.keyFor(
            dataset.handle,
            { id: link.sourceId, type: link.sourceType },
            { id: link.targetId, type: link.targetType },
          ),
        },
      );
      setLastCreatedId(id);
      return id;
    } catch (error) {
      // A toast rather than `recordErrors`: there is no form on screen holding what somebody typed,
      // so the only place a failure can be reported is the one that does not need one.
      console.error('RecordStore: connecting two records failed', error);
      toasts.error('Could not draw that connection.');
      return '';
    }
  }

  /**
   * Anything typed into the open form.
   *
   * Compared against the field's *empty* value rather than against what it was seeded with, because
   * this form only ever creates — there is no edit path through it, so "seeded" is the default the
   * model declares and changing it away from that is the author's doing. A boolean is deliberately
   * not counted: a checkbox starts false and toggling it back is not work worth a dialog.
   */
  const recordDraftDirty = reactivity.memo(() => {
    const draft = recordDraft();
    // Tracked, not used: a field written in place changes nothing the memo would otherwise see.
    draftEdits();
    if (!draft) return false;
    /*
      Changed from what it started as — not "holds something".

      Every field is seeded: a number to `0`, a select to whatever the model declares
      (`TaskBlock.status` is `'todo'`). Asking whether a field held anything therefore answered yes
      for a form nobody had touched, so closing an untouched Task form raised "discard your
      changes?". `field.initial` is the seed, kept beside the value when the draft is built.

      Strings are trimmed on both sides so typing a space and deleting it is not work; other kinds
      compare directly, since a boolean or a number is only ever set deliberately.
    */
    return recordDraftChanged(draft);
  });

  function cancelRecordForm(): void {
    reactivity.batch(() => {
      setRecordDraft(null);
      setRelationDraft(null);
      setRelationErrors([]);
      setRecordErrors([]);
      setPendingLink(null);
      setPendingBoard('');
      setKind('');
      setPendingPoint(null);
    });
  }

  function createOnCanvas(canvas: string, x?: number, y?: number): void {
    if (!canvas) return;
    openRecordForm();
    reactivity.batch(() => {
      setPendingBoard(canvas);
      // A point only when somebody chose one — a double-click on the canvas has one, a toolbar
      // button does not. Inventing `(0, 0)` for the second case is what made a new record appear at
      // the world origin, which is wherever the reader is not looking.
      setPendingPoint(x !== undefined && y !== undefined ? { x, y } : null);
    });
  }

  async function saveRecord(): Promise<void> {
    const draft = recordDraft();
    const dataset = datasetStore.currentDataset();
    if (!draft || !dataset) return;

    const errors = recordDraftErrors(draft);
    if (errors.length) {
      setRecordErrors(errors);
      return;
    }

    setSavingRecord(true);
    try {
      const link = pendingLink();
      const fields = recordDraftFields(draft);

      /*
        Created *inside* the canvas when there is one, not merely positioned on it.

        A canvas holds things by containment and positions them by placement — two facts, and it
        needs both. Writing only the placement made a record that existed, had a coordinate, and was
        invisible: the canvas's seed asks for each type among the canvas's own children, and a record
        created loose in the space is nobody's child. It turned up in the cards route, which asks the
        space rather than the canvas, which is exactly the shape of that bug from the outside.
      */
      const canvas = pendingBoard();
      // A space canvas's content lives in the space collection, as does anything made with no canvas
      // at all — see `provideContentHomes`.
      const home = contentHome(canvas || undefined);

      /*
        One write either way, its relations and any records filled in inline for them included. A
        connection is the declared `core.connectRecords`: its ends, their types and its key. Its kind
        only when one was chosen — an empty one would name a kind that does not exist. Any other
        record is `core.createRecord`, over whichever entity the form chose from any model the space
        has.
      */
      const invocationId = crypto.randomUUID();
      const { relations, inline } = await relationFields(draft, invocationId);
      const invoker = session.me()?.did;
      if (!invoker) throw new Error('Sign in to make this.');
      const run = (name: string, args: Record<string, unknown>) =>
        invokeOperation(name, args, { dataset: dataset.handle, invoker, invocationId });
      const createdId = link
        ? await run('core.connectRecords', {
            source: link.sourceId,
            sourceType: link.sourceType,
            target: link.targetId,
            targetType: link.targetType,
            key: await connections.keyFor(
              dataset.handle,
              { id: link.sourceId, type: link.sourceType },
              { id: link.targetId, type: link.targetType },
              fields.label,
            ),
            ...(relationshipKind() ? { kind: relationshipKind() } : {}),
            fields: { ...fields, ...relations },
            ...(home ? { home } : {}),
            ...(inline.length ? { inline } : {}),
          })
        : await run('core.createRecord', {
            entity: draft.entity,
            fields: { ...fields, ...relations },
            ...(home ? { home } : {}),
            ...(inline.length ? { inline } : {}),
          });
      const created = { id: typeof createdId === 'string' ? createdId : '' };

      /*
        Placed only where somebody chose a point, and after the record exists.

        After, because a placement points at something and placing first would leave a coordinate for
        nothing. Only-where-chosen, because a record with no placement is *unplaced* — the layout
        parks it in a tray in view, which is a state a person can see and act on. Writing `(0, 0)`
        instead dressed "nobody said" up as an answer, and put the card at the world origin.
      */
      const at = pendingPoint();
      // No undo entry, for `dropOnCanvas`'s reason: this is a record being *made*, and undoing it by
      // unplacing would leave the new record behind rather than putting anything back.
      if (canvas && at && created?.id) await placing.writePlacement(canvas, created.id, draft.entity, at.x, at.y);

      reactivity.batch(() => {
        setLastCreatedId(created?.id ?? '');
        setRecordDraft(null);
        setRecordErrors([]);
        setPendingLink(null);
        setPendingBoard('');
        setKind('');
        setPendingPoint(null);
      });
      toasts.success(`${draft.label} created.`);
    } catch (error) {
      // Reported into the form rather than only as a toast: the modal stays open holding what was
      // typed, so a failure is something to correct rather than something that loses the work.
      const message = error instanceof Error ? error.message : String(error);
      setRecordErrors([message]);
      console.error('RecordStore: creating a record failed', error);
    } finally {
      setSavingRecord(false);
    }
  }

  return {
    recordDraft,
    recordDraftDirty,
    recordErrors,
    savingRecord,
    lastCreatedId,
    pendingLink,
    openRecordForm,
    connectNodes,
    connectNodesNow,
    createOnCanvas,
    setRecordEntity,
    setRecordField,
    setRecordPlace,
    relationDraft,
    relationErrors,
    openRelationForm,
    setRelationField,
    saveRelationForm,
    cancelRelationForm,
    pickRelation,
    removeRelationEntry,
    setRelationLocation,
    setRelationEntryField,
    addRelationImage,
    relationshipKind,
    setRelationshipKind,
    cancelRecordForm,
    saveRecord,
  };
}
