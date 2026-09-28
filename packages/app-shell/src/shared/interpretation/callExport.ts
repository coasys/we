/**
 * What a call looks like written to a file: its transcript, and everything extraction did with it.
 *
 * Pure, so the store only gathers and downloads. Both exports exist to be handed to a person or a
 * model investigating a call — "why did it extract *that*", "what should the prompt say instead" —
 * so the log is written for a reader with nothing else on screen: every pass with its prompt and
 * response verbatim, what the call was set up to look for, what ended up stored, and what is still
 * waiting on somebody.
 *
 * Markdown rather than JSON. Prompts are long prose; escaped into a JSON string each becomes one
 * enormous line, which is harder for a person to read and no easier for a model. Fenced blocks keep
 * them verbatim and still split cleanly.
 */
import type { InterpretationProposal, TranscriptTurn } from '@we/backend-shared';
import { recordTypeOf } from '@we/backend-shared';

import { formatJson } from '../sources/formatJson';

/**
 * One line of a plain-text transcript: a name, a time, and what they said.
 *
 * A text file has no badges, so what is not speech says so in words. A typed line and a mended one
 * would otherwise both pass as verbatim, in the artefact most likely to be quoted back. Marked only
 * where there is something to say — an annotation on every spoken line would be noise.
 */
export function transcriptLine(turn: TranscriptTurn, nameFor: (did: string) => string): string {
  const mark = turn.source === 'typed' ? ' (typed)' : turn.source === 'corrected' ? ' (corrected)' : '';
  return `${nameFor(turn.speaker)}, ${turn.timestamp}${mark}: ${turn.text}`;
}

/**
 * A file name from a call's title, stamped with the export time so successive exports of one call
 * do not overwrite each other. Punctuation is dropped rather than escaped: a title is somebody's
 * words, and a slash in one is a directory on the way to the disk.
 */
export function exportFileName(
  title: string | undefined,
  fallback: string,
  extension: string,
  at = new Date(),
): string {
  const slug =
    (title ?? '')
      .trim()
      .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || fallback;
  return `${slug}-${at.toISOString().replace(/[:.]/g, '-')}.${extension}`;
}

/**
 * A fenced block that cannot be closed by what is inside it.
 *
 * A prompt carries the transcript, and a transcript can carry backticks — somebody pasting code
 * into a call. A fixed three-backtick fence then ends mid-prompt and the rest of the file reads as
 * something else. One longer than the longest run inside is always safe.
 */
export function fenced(text: string, language = ''): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
}

/** Epoch milliseconds or an ISO string, as ISO — the ORM hands back either. Empty when neither. */
export function isoOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return '';
}

/**
 * A stored record's own values, as plain data.
 *
 * A record read through the model layer is an instance: private handles to its dataset, getters,
 * relation arrays. What a reader wants is what it *says*, so this keeps scalars and lists of
 * scalars, drops the private fields (`_`-prefixed, which includes the type tag — reported
 * separately), and leaves out the empty ones, which on a record with a dozen unset optional
 * properties are most of it.
 */
export function plainFields(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== 'object') return {};
  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const scalar = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value);
  // `id` first, and read explicitly: on a model instance it is a getter, not an own property.
  if (typeof source.id === 'string') out.id = source.id;
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('_') || key === 'id') continue;
    if (value === null || value === undefined || value === '') continue;
    if (scalar(value)) out[key] = key === 'createdAt' || key === 'updatedAt' ? isoOf(value) : value;
    else if (Array.isArray(value) && value.length > 0 && value.every(scalar)) out[key] = value;
  }
  return out;
}

/** One stored `ExtractionPass`, as the log needs it. */
export interface PassEntry {
  createdAt: unknown;
  author?: string;
  trigger?: string;
  outcome?: string;
  recordCount?: number;
  /** A JSON array of entity names, as stored. */
  targets?: string;
  error?: string;
  prompt?: string;
  response?: string;
}

/** One stored `ExtractionAmendment` — a change to an agreed record that somebody kept. */
export interface AmendmentEntry {
  createdAt: unknown;
  /** Who accepted it, which is not who wrote the record. */
  author?: string;
  property?: string;
  previousValue?: string;
  newValue?: string;
  nodeType?: string;
  /** The amended record's id. A to-one relation, so a bare URI. */
  node?: string;
}

export interface ExtractionLogInput {
  callId: string;
  callTitle?: string;
  spaceName?: string;
  exportedAt: Date;
  /** What this call looks for, after its participants' own choices. */
  callTargets: string[];
  /** What the space's calls start out looking for. */
  spaceTargets: string[];
  autoInterpret: boolean;
  transcript: TranscriptTurn[];
  passes: PassEntry[];
  /** The records a pass wrote against this call, whatever became of them since. */
  records: unknown[];
  /** Suggestions still staged on this call. */
  proposals: InterpretationProposal[];
  /**
   * Changes to already-agreed records that somebody kept.
   *
   * Not derivable from anything else in this log, which is why it is carried separately. The
   * records section shows values as they stand now and says nothing about how they got there; the
   * pass response holds what was *proposed*, not what was accepted or what it replaced. This is the
   * only place the previous value appears at all.
   */
  amendments: AmendmentEntry[];
  nameFor: (did: string) => string;
}

const list = (items: string[]) => (items.length ? items.join(', ') : '(none)');

function parseTargets(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** The whole log, as one Markdown document. */
export function formatExtractionLog(input: ExtractionLogInput): string {
  const title = input.callTitle?.trim() || 'Untitled call';
  const passes = [...input.passes].sort((a, b) => isoOf(a.createdAt).localeCompare(isoOf(b.createdAt)));
  // What is waiting on each record, by kind: a record extraction made, or a change to an agreed one.
  const waiting = new Map(input.proposals.map((proposal) => [proposal.id, proposal.kind]));
  const out: string[] = [];

  out.push(
    `# Extraction log: ${title}`,
    '',
    `- Call id: \`${input.callId}\``,
    ...(input.spaceName ? [`- Space: ${input.spaceName}`] : []),
    `- Exported: ${input.exportedAt.toISOString()}`,
    '',
    /*
      A paragraph for whoever this is handed to, which is as likely to be a model as a person. It
      has no other way to learn what the sections are or that the prompt is the ground truth.
    */
    'Every extraction pass run over this call, oldest first. Each pass shows what started it, who ran it, ' +
      'how it ended, and the exact prompt the model was given and the response it returned. After the ' +
      'passes: the records extraction wrote against this call as they are stored now (people may have ' +
      'edited them since), the changes it suggested to records that already existed and somebody kept, ' +
      'and the suggestions still waiting on a decision. The transcript the passes read is included ' +
      'once, below the settings.',
    '',
    '## Settings',
    '',
    `- Looking for, on this call: ${list(input.callTargets)}`,
    `- Space default: ${list(input.spaceTargets)}`,
    `- Extracts automatically as the call happens: ${input.autoInterpret ? 'yes' : 'no'}`,
    '',
    `## Transcript (${input.transcript.length} ${input.transcript.length === 1 ? 'line' : 'lines'})`,
    '',
    input.transcript.length
      ? fenced(input.transcript.map((turn) => transcriptLine(turn, input.nameFor)).join('\n'), 'text')
      : '_Nothing has been transcribed on this call._',
    '',
    `## Passes (${passes.length})`,
    '',
  );

  if (!passes.length) out.push('_No extraction pass has run on this call._', '');

  passes.forEach((pass, index) => {
    const targets = parseTargets(pass.targets);
    out.push(
      `### Pass ${index + 1}: ${isoOf(pass.createdAt) || 'unknown time'}`,
      '',
      `- Trigger: ${pass.trigger || 'manual'}`,
      `- Run by: ${pass.author ? `${input.nameFor(pass.author)} (\`${pass.author}\`)` : 'unknown'}`,
      `- Outcome: ${pass.outcome || 'done'}`,
      `- Records written: ${pass.recordCount ?? 0}`,
      `- Looking for: ${list(targets)}`,
      ...(pass.error ? [`- Error: ${pass.error}`] : []),
      '',
      '#### Prompt',
      '',
      pass.prompt ? fenced(pass.prompt) : '_Not recorded._',
      '',
      '#### Response',
      '',
      /*
        Pretty-printed where it parses, since a model's structured answer is one line as returned.
        Fenced as JSON only when it did parse — labelling prose `json` misleads a reader.
      */
      pass.response
        ? (() => {
            const pretty = formatJson({ text: pass.response });
            return fenced(pretty, pretty === pass.response ? '' : 'json');
          })()
        : '_Not recorded._',
      '',
    );
  });

  out.push(`## Extracted records (${input.records.length})`, '');
  if (!input.records.length) out.push('_Nothing extracted from this call is stored._', '');
  for (const record of input.records) {
    const fields = plainFields(record);
    const id = typeof fields.id === 'string' ? fields.id : '';
    out.push(
      `### ${recordTypeOf(record) ?? 'Record'}${id ? `: \`${id}\`` : ''}`,
      '',
      `- Awaiting a decision: ${waiting.get(id) === 'create' ? 'yes — made by extraction, not kept yet' : waiting.get(id) === 'update' ? 'yes — a change to it is suggested' : 'no'}`,
      ...(typeof fields.author === 'string' ? [`- Author: ${input.nameFor(fields.author)}`] : []),
      '',
      fenced(JSON.stringify(fields, null, 2), 'json'),
      '',
    );
  }

  /*
    The fourth quadrant, and the one that used to be missing entirely.

    A record extraction *wrote* is above; a suggestion still *waiting* is below. A change that was
    accepted appears in neither: it is usually to a record no pass here created, so it is not in the
    records section, and it is settled, so it is not in the waiting one. Until these were stored,
    the value simply changed and the log said nothing about it.
  */
  out.push(`## Accepted changes (${input.amendments.length})`, '');
  if (!input.amendments.length) out.push('_No suggested change to an existing record has been kept on this call._', '');
  for (const amendment of input.amendments) {
    out.push(
      `### ${amendment.nodeType || 'Record'}${amendment.node ? `: \`${amendment.node}\`` : ''}`,
      '',
      `- Property: \`${amendment.property ?? ''}\``,
      // Quoted, so an empty previous value is visibly empty rather than a gap in the line.
      `- Was: ${JSON.stringify(amendment.previousValue ?? '')}`,
      `- Now: ${JSON.stringify(amendment.newValue ?? '')}`,
      `- Kept by: ${amendment.author ? `${input.nameFor(amendment.author)} (\`${amendment.author}\`)` : 'unknown'}`,
      `- When: ${isoOf(amendment.createdAt) || 'unknown time'}`,
      '',
    );
  }

  out.push(`## Awaiting a decision (${input.proposals.length})`, '');
  if (!input.proposals.length) out.push('_No suggestions are waiting on this call._', '');
  for (const proposal of input.proposals) {
    out.push(
      `### ${proposal.kind === 'update' ? 'Change to' : 'New'} ${proposal.entity ?? 'record'}: \`${proposal.id}\``,
      '',
      fenced(JSON.stringify(proposal.values, null, 2), 'json'),
      '',
    );
  }

  return `${out.join('\n').trimEnd()}\n`;
}
