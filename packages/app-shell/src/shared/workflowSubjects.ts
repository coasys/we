/**
 * What a record going through a workflow is called — the subject of a run, as a row on the Workflows page
 * names it.
 *
 * The name comes from the record itself, read the way every other surface reads it: the property the
 * model says names it, else the fields that name a record by convention ({@link NAME_CANDIDATES}).
 * Where neither says anything — a record with no text, or one not read yet — the row names what kind of
 * thing it is and a short piece of its id, which tells two of them apart where "Untitled" did not.
 */
import { NAME_CANDIDATES } from '@we/backend-shared';

import { modelLabel } from './shapes/recordDisplay';

/** What is known of a run's subject: its name, empty when it has none, and its entity, empty when unknown. */
export interface SubjectName {
  title: string;
  entity: string;
}

const MAX_TITLE = 80;

/** A record's name for one line: its naming property, else the conventional ones; empty when none holds text. */
export function subjectTitleOf(row: Record<string, unknown>, nameProperty = ''): string {
  const keys = nameProperty ? [nameProperty, ...NAME_CANDIDATES] : NAME_CANDIDATES;
  for (const key of keys) {
    const value = row[key];
    if (typeof value !== 'string') continue;
    // A post or a note keeps what it says as markup; the row wants the words.
    const plain = value
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) return plain.length > MAX_TITLE ? `${plain.slice(0, MAX_TITLE - 1).trimEnd()}…` : plain;
  }
  return '';
}

/** The last six letters and digits of an id — enough to tell two records apart in a list. */
export function shortIdOf(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-6);
}

/** What a row calls the subject: its name, else its kind and a short id. */
export function subjectLabel(subject: SubjectName, record: string): string {
  if (subject.title) return subject.title;
  return `${subject.entity ? modelLabel(subject.entity) : 'Record'} ${shortIdOf(record)}`.trim();
}
