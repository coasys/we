/**
 * How a setting on a space's own record is written: stored through its operation or as fields, then
 * published onto the held record and the space on screen — and, for the few a person sees change
 * before the write lands, shown first and held over the live read until it does. Part of
 * `SpaceStore` — see `../SpaceStore.ts`.
 *
 * Every job that writes to a space record goes through these: the space's defaults, its modules and
 * sections, what it extracts, its task-state rule.
 */
import { Space } from '@we/entities';
import { type Latest, latest } from '@we/module-shared';

import { isSpaceSelf } from '../../spaceSync';
import type { AppDataset } from '../DatasetStore';
import type { SpaceContext } from './context';
import type { SpaceList } from './spaces';

export interface SpaceWritesDeps extends Pick<SpaceContext, 'toasts' | 'runCore' | 'isCurrent'> {
  spaces: Pick<SpaceList, 'heldSpace' | 'spaceRow'> & { members: Pick<SpaceList['members'], 'updateSpaceInCache'> };
  /**
   * The space on screen, from the navigation part — composed after this one, and reached only when a
   * write is made: what it shows, and showing fields on it.
   */
  onScreen: { current: () => Space | null; show: (ds: AppDataset, fields: Partial<Space>) => void };
}

export function createSpaceWrites(deps: SpaceWritesDeps) {
  const { toasts, runCore, isCurrent, spaces, onScreen } = deps;
  const { heldSpace, spaceRow } = spaces;
  const { updateSpaceInCache } = spaces.members;

  /**
   * Show fields on the cached row and, when the dataset is on screen, on `currentSpace` — onto the
   * record only when it is that dataset's own, since a switch moves the dataset ahead of the record.
   *
   * Each as a *new* instance: both are plain signals that skip a write of what they hold, so handing
   * back the object just written through notifies nothing and every reader keeps the previous value.
   */
  function publishSpaceFields(ds: AppDataset, fields: Partial<Space>): void {
    updateSpaceInCache(ds, fields);
    if (isCurrent(ds)) onScreen.show(ds, fields);
  }

  /**
   * How a failed space write is told to the person: logged, and the same toast whatever it was.
   * A setting that reports success without persisting is worse than one that fails visibly,
   * because the setting is a community decision and the next member to open the page sees the old
   * one.
   */
  const reportSpaceSave = (what: string, error: unknown): void => {
    console.error(`SpaceStore: could not persist ${what}`, error);
    toasts.error('Could not save this change for the space.');
  };

  /**
   * Persist fields on a space's own record, then publish them — unless `shouldPublish` says a newer
   * save has since taken over what is shown.
   */
  async function writeSpaceFields(
    ds: AppDataset,
    space: Space,
    fields: Partial<Space>,
    shouldPublish: () => boolean = () => true,
  ): Promise<void> {
    try {
      await Space.update(ds.handle, space.id, fields);
    } catch (error) {
      reportSpaceSave(Object.keys(fields).join(', '), error);
      throw error;
    }
    if (shouldPublish()) publishSpaceFields(ds, fields);
  }

  /**
   * Change one setting on a space's own record through the operation that holds its rule — worked
   * out from what the record holds when the write is made, not from the copy this screen has — then
   * publish the value it wrote.
   */
  async function writeSpaceSetting<K extends keyof Space>(
    ds: AppDataset,
    space: Space,
    operation: string,
    field: K,
    args: Record<string, unknown>,
  ): Promise<void> {
    let written: Space[K];
    try {
      written = await runCore<Space[K]>(operation, { space: space.id, ...args }, ds.handle);
    } catch (error) {
      reportSpaceSave(String(field), error);
      throw error;
    }
    publishSpaceFields(ds, { [field]: written });
  }

  /*
    A default save paints its choice before it is stored, and two can be out at once — so what a
    failed save puts back is kept here rather than re-read off the screen, where mid-save it is
    the other save's paint, not anything the record took. `confirmed` is the last value the record
    took: seeded while nothing is pending (the value shown is then the value stored) and moved on
    each save that lands. `ops` says whether a save is still the newest for its field — an earlier
    one failing or landing must not take back or overwrite a later one's paint with it. `tail` is
    the store writes in the order they were asked, so the backend cannot finish an older choice
    after a newer one and leave it stored. The record is dropped when nothing is pending, so the
    next save seeds its baseline from what the cache says then, which the live read may have
    moved on.
  */
  const defaultSaves = new Map<
    string,
    {
      key: string;
      /** The field's value — an id for a default, a list of entity names for the interpretation list. */
      confirmed: unknown;
      value: unknown;
      ops: Latest;
      pending: number;
      tail: Promise<unknown>;
    }
  >();

  /**
   * The newest choice of each default still being saved, and of the interpretation list, for a live row
   * to show over. The interpretation list is one of these saves too: a switch merges into the list
   * already published, and a row from before that write must not put the old list back.
   */
  const pendingDefaults = (ds: AppDataset): Partial<Space> => {
    const fields: Partial<Space> = {};
    for (const field of ['defaultTemplateId', 'defaultThemeId', 'extractionTargets'] as const) {
      const save = defaultSaves.get(`${ds.id}:${field}`);
      if (save) (fields as Record<string, unknown>)[field] = save.value;
    }
    return fields;
  };

  const defaultSaveFor = (ds: AppDataset, field: 'defaultTemplateId' | 'defaultThemeId' | 'extractionTargets') => {
    const key = `${ds.id}:${field}`;
    let save = defaultSaves.get(key);
    if (!save) {
      // The shown fallback asks for ds's own record, not just the dataset: a switch moves the
      // dataset ahead of the record on screen, and the space being left's record is not a baseline.
      const shown = onScreen.current();
      save = {
        key,
        confirmed: heldSpace(ds)?.[field] ?? (shown && isSpaceSelf(shown, ds) ? shown[field] : undefined),
        value: undefined,
        ops: latest(),
        pending: 0,
        tail: Promise.resolve(),
      };
      defaultSaves.set(key, save);
    }
    return save;
  };

  /** Run a default's store write after the ones already asked for the same field, whether they landed or not. */
  const queueDefaultWrite = (save: { tail: Promise<unknown> }, write: () => Promise<void>): Promise<void> => {
    const run = save.tail.catch(() => {}).then(write);
    save.tail = run;
    return run;
  };

  /** A default save has finished, landed or not: its record goes once nothing is pending for the field. */
  const endDefaultSave = (save: { key: string; pending: number }): void => {
    save.pending -= 1;
    if (!save.pending) defaultSaves.delete(save.key);
  };

  /*
    The row a default save writes through, inside the same failure boundary as the write — and read
    inside the queued write, so two saves whose reads finish out of order still write in the order
    they were asked. A read that cannot answer, and a space with no record at all, were silent
    successes: the paint already up stayed, with nothing saved and nothing said. Reported the way
    the write reports, so the caller's failure path takes the publish back.
  */
  const spaceRowForSave = async (ds: AppDataset): Promise<Space> => {
    try {
      const space = await spaceRow(ds);
      if (!space) throw new Error(`SpaceStore: no space record for ${ds.id}`);
      return space;
    } catch (error) {
      reportSpaceSave('the space record', error);
      throw error;
    }
  };

  return {
    publishSpaceFields,
    reportSpaceSave,
    writeSpaceFields,
    writeSpaceSetting,
    pendingDefaults,
    defaultSaveFor,
    queueDefaultWrite,
    endDefaultSave,
    spaceRowForSave,
  };
}

export type SpaceWrites = ReturnType<typeof createSpaceWrites>;
