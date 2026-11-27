/**
 * A call's two exports — its transcript as text and everything interpretation did with it as Markdown —
 * and what they share: one gather for the transcript, one label for each person, one report of the save.
 */
import { displayName, type InterpretationPort } from '@we/backend-shared';
import { saveFile, type SaveOutcome } from '@we/design-utils';
import { CollectionBlock, type DatasetProxy, getEntityForDataset } from '@we/entities';

import {
  type AmendmentEntry,
  exportFileName,
  formatInterpretationLog,
  type PassEntry,
  transcriptLine,
} from '../../interpretation/callExport';
import { gatherTranscriptTurns, type TurnRecord } from '../../interpretation/transcriptTurns';
import type { Toasts } from '../../toasts';
import type { ProfileStore } from '../ProfileStore';

/** What the exports read from the space they are made in. */
export interface CallExportDeps {
  toasts: Toasts;
  /** The dataset of the space the call is in, or nothing outside a space. */
  dataset: () => { handle: DatasetProxy } | null | undefined;
  interpretation: () => InterpretationPort | undefined;
  profileStore: Pick<ProfileStore, 'fetchProfile' | 'profiles'>;
  /**
   * The space's name and the call's extraction answers — what this call interprets, what the space
   * extracts, and whether this call is interpreted as it grows — read for the dataset named rather
   * than the space on screen, which may have moved on by the time the gathered content is laid out.
   */
  exportMeta: (
    handle: DatasetProxy,
    callId: string,
  ) => Promise<{ spaceName?: string; spaceTargets: string[]; auto: boolean; classes: string[] }>;
}

export function createCallExports(deps: CallExportDeps) {
  const { profileStore, toasts } = deps;

  /**
   * A call's transcript, through the same gather extraction runs on rather than a second reading of
   * the same shape. What a turn is — which entities can be one, which rows are too broken to keep,
   * and the ordering that makes a transcript a transcript rather than a bag of sentences — is one
   * decision, and an export that answered it differently would disagree with what the model was shown.
   */
  async function callTranscript(p: DatasetProxy, callId: string) {
    const modelFor = (entity: string) => getEntityForDataset(entity, p);
    const turns = await gatherTranscriptTurns(
      { modelFor: (entity) => modelFor(entity) as TurnRecord | undefined, handle: p },
      callId,
    );
    return { turns };
  }

  /**
   * A label for each of these agents, fetched first.
   *
   * Asked for before labelling any of them: the cache is populated as a side effect of rendering
   * people, so relying on it alone exports whoever happens to be on screen by name and everybody else
   * as a raw DID. `fetchProfile` no-ops on a profile it holds and dedupes concurrent calls.
   *
   * The DID is the fallback rather than the cache's own `name`, which falls back to "Anonymous".
   * That is right on screen, where a face tells one unnamed peer from another, and wrong in a file,
   * where the label is all there is: three unnamed speakers would be three identical lines. The cache
   * is keyed on the bare DID, so a prefixed one is stripped to match.
   */
  async function labelsFor(dids: string[]): Promise<(did: string) => string> {
    await Promise.all([...new Set(dids)].map((did) => profileStore.fetchProfile(did).catch(() => undefined)));
    return (did: string): string => {
      const profile = profileStore.profiles().find((entry) => entry.did === did.replace('did://', ''));
      return profile ? displayName(profile, did) : did;
    };
  }

  /**
   * What a save came to, said once for both exports.
   *
   * Only a file actually written earns a success message — `saveFile` knows whether one was.
   * A cancelled dialog says nothing, and a plain download is confirmed by the browser's own UI.
   */
  function reportSave(outcome: SaveOutcome, saved: string, empty: string): void {
    if (outcome === 'saved') toasts.success(saved);
    else if (outcome === 'empty') toasts.warning(empty);
  }

  /*
    Both exports name the file before anything else and gather the content inside `saveFile`. The
    order is the point: a browser opens a save dialog only while the click that asked for it is still
    being handled, and gathering a transcript or a log can outlast that. The title is one small read.
  */
  async function exportCallTranscript(callId: string): Promise<void> {
    const dataset = deps.dataset();
    if (!dataset || !callId) return;
    const p = dataset.handle;
    try {
      const call = await CollectionBlock.findOne(p, { where: { id: callId } });
      const outcome = await saveFile({
        name: exportFileName(call?.title, 'call-transcript', 'txt'),
        type: 'text/plain;charset=utf-8',
        content: async () => {
          const { turns } = await callTranscript(p, callId);
          if (!turns.length) return null;
          const nameFor = await labelsFor(turns.map((turn) => turn.speaker));
          return `${turns.map((turn) => transcriptLine(turn, nameFor)).join('\n')}\n`;
        },
      });
      reportSave(outcome, 'Transcript exported.', 'This call has no transcript to export.');
    } catch (error) {
      console.error('SpaceStore: exportCallTranscript failed', error);
      toasts.error('Could not export the transcript.');
    }
  }

  /**
   * Everything extraction did with one call, as one Markdown file — see `formatInterpretationLog`.
   *
   * Every member's passes, not only this agent's: the prompts and responses are stored on the shared
   * record, so this exports what the panel already shows. Read in full rather than through the
   * panel's query, which is capped for drawing and an hour of automatic interpretation outruns.
   */
  async function exportInterpretationLog(callId: string): Promise<void> {
    const dataset = deps.dataset();
    if (!dataset || !callId) return;
    const p = dataset.handle;
    try {
      const exportedAt = new Date();
      /*
        Only the title is read before `saveFile`: a browser opens the save dialog only while the
        click that asked for it is still being handled, and the settings read can outlive that —
        the dialog would refuse and the file would land as a plain download. The space's answers
        are gathered inside the content callback instead, still for the call's own dataset through
        the captured handle, so by the time they resolve the space on screen may be another's and
        none of that reaches the file.
      */
      const titled = await CollectionBlock.findOne(p, { where: { id: callId } });
      const outcome = await saveFile({
        name: exportFileName(titled?.title, 'call', 'md', exportedAt).replace(/\.md$/, '-interpretation-log.md'),
        type: 'text/markdown;charset=utf-8',
        content: async () => {
          // The settings head the log and are not its substance: unreadable, the history still goes.
          // Started with the call's read but awaited only once there is a log to head, so a call with
          // no passes is answered without them; the fallback keeps an early return from leaving a rejection.
          const settings = deps.exportMeta(p, callId).catch((error) => {
            console.error('SpaceStore: exportInterpretationLog could not read the settings', error);
            return undefined;
          });
          const call = await CollectionBlock.findOne(p, {
            where: { id: callId },
            /*
              `polymorphic` said here rather than trusted to the declaration. `extracted` names no
              target class — a pass writes whatever models the call looks for — and the class this
              store reads through does not carry the flag, so the backend would refuse to hydrate it.
            */
            include: {
              runs: { where: { kind: 'extraction' } },
              extracted: { polymorphic: true },
              amendments: true,
            },
          } as never);
          const row = call as unknown as {
            title?: string;
            runs?: unknown;
            extracted?: unknown;
            amendments?: unknown;
          } | null;
          const passes = (Array.isArray(row?.runs) ? row.runs : []) as PassEntry[];
          const records = Array.isArray(row?.extracted) ? (row.extracted as unknown[]) : [];
          const amendments = (Array.isArray(row?.amendments) ? row.amendments : []) as AmendmentEntry[];
          if (!passes.length) return null;
          const meta = await settings;

          const { turns } = await callTranscript(p, callId);
          // Scoped to this call, as the review list is; best effort, since a log without the waiting
          // suggestions is still the log.
          const port = deps.interpretation();
          const proposals = port
            ? await port.proposals(p, { parent: { id: callId, relation: 'children' } }).catch(() => [])
            : [];
          const authors = records.map((record) => (record as { author?: unknown }).author);
          const nameFor = await labelsFor(
            [
              ...turns.map((turn) => turn.speaker),
              ...passes.map((pass) => pass.author),
              // Who *kept* a change, which is a different person from whoever wrote the record.
              ...amendments.map((amendment) => amendment.author),
              ...authors,
            ].filter((did): did is string => typeof did === 'string' && did !== ''),
          );

          return formatInterpretationLog({
            callId,
            callTitle: row?.title,
            spaceName: meta?.spaceName,
            exportedAt,
            callTargets: meta?.classes,
            spaceTargets: meta?.spaceTargets,
            autoInterpret: meta?.auto,
            transcript: turns,
            passes,
            records,
            proposals,
            amendments,
            nameFor,
          });
        },
      });
      reportSave(outcome, 'Interpretation log exported.', 'No interpretation has run on this call yet.');
    } catch (error) {
      console.error('SpaceStore: exportInterpretationLog failed', error);
      toasts.error('Could not export the interpretation log.');
    }
  }

  return { exportCallTranscript, exportInterpretationLog };
}
