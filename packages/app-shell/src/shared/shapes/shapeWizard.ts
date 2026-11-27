/**
 * The shape wizard's decisions over a draft: what the generate button would do, whether closing
 * loses work, what a generation is asked, and which field names a record.
 *
 * Pure and framework-free, beside `shapeDraft.ts` (what a draft is and how it lowers): the store
 * holds the draft and calls these, so a rule here is the same whether a memo tracks it or an action
 * asks it fresh at the moment of a click.
 */
import { namePropertyOf } from '@we/backend-shared';

import {
  draftToManifest,
  type GeneratedField,
  type GeneratedOutput,
  isTouched,
  memberSignature,
  type ShapeDraft,
} from './shapeDraft';

/**
 * What clicking the wizard's generate button would do, given what the draft currently holds.
 *
 * Generation replaces the member list wholesale, so the interesting distinction is what stands to
 * be lost: `generate` (nothing yet), `regenerate` (a proposal nobody has touched — the "try again"
 * that must stay one click), `replace` (rows somebody wrote, so it asks first), `none` (there is
 * nothing to generate from).
 */
export type GenerateIntent = 'none' | 'generate' | 'regenerate' | 'replace';

/**
 * The guard itself. Generation replaces the member list wholesale, so what the button may do
 * depends entirely on what would be lost: nothing (`generate`), a proposal nobody has touched
 * (`regenerate` — the "try again" that must not cost a dialog), or somebody's own work (`replace`,
 * which asks first).
 *
 * The context test is deliberately over everything present, the author's words or not: a draft
 * carrying a generated description has something to re-run from, and greying the button there
 * would be refusing to act on a form that visibly has writing in it.
 */
export function generateIntentOf(draft: ShapeDraft | null, last: GeneratedOutput | null): GenerateIntent {
  if (!draft) return 'none';
  const hasContext = Boolean(draft.name.trim() || draft.description.trim() || draft.classHint.trim());
  if (!hasContext) return 'none';
  if (!draft.members.some(isTouched)) return 'generate';
  return memberSignature(draft.members) === last?.members ? 'regenerate' : 'replace';
}

/**
 * Whether closing would throw anything away.
 *
 * A pristine wizard — opened and not typed in — closes without ceremony; asking there would train
 * the answer out of anyone. Editing an existing model asks whether it *changed*, not whether it is
 * filled in: opening a model to read it and pressing Escape must not ask "discard this model?"
 * about nothing. So an edit is compared against `opened`, the draft serialised as it opened (a
 * frozen copy: rows are mutated in place while typing, so nothing but a copy taken then can say
 * what they held).
 */
export function draftHasWork(draft: ShapeDraft | null, editing: { opened: string | null } | null): boolean {
  if (!draft) return false;
  if (editing) return editing.opened !== null && JSON.stringify(draft) !== editing.opened;
  if (draft.name.trim() || draft.description.trim() || draft.classHint.trim() || draft.icon) return true;
  return draft.members.some((m) => m.name.trim() || m.hint.trim() || m.options.trim() || m.target || m.defaultValue);
}

/**
 * What a field generation is asked: what the author wrote, and only that.
 *
 * A previous generation's own description and hint are still sitting in the form, and feeding them
 * back would quote the last answer as part of the next question: renaming a model to "MovieNight"
 * while its generated description still discussed books returned a model about both. Fields
 * generation wrote are dropped here and re-answered, so a re-run follows the rename — and pressing
 * Regenerate twice over an untouched draft is a fresh attempt rather than a slow convergence on the
 * first one.
 *
 * With nothing of the author's left to go on — they generated a model and then deleted the name
 * they started from — what remains is the machine's, but it is all there is, and a prompt built from
 * it beats refusing a button the form gives every reason to expect to work.
 */
export function generationPrompt(draft: ShapeDraft, authored: Record<GeneratedField, string>): string {
  const lines = (fields: Record<'name' | 'description' | 'classHint', string>) =>
    [
      fields.name && `The model is called "${fields.name}".`,
      fields.description && `Description: ${fields.description}`,
      fields.classHint && `Guidance for AI interpretation: ${fields.classHint}`,
    ].filter(Boolean);
  const asked = lines(authored);
  if (asked.length) return asked.join('\n');
  return lines({
    name: draft.name.trim(),
    description: draft.description.trim(),
    classHint: draft.classHint.trim(),
  }).join('\n');
}

/**
 * A field generation landed on the open draft: the author's words survive, the generation answers
 * everything else — the fields, and any top-level blank, including the ones its own last run had
 * filled. `last` is the record of what generation contributed: '' for anything the author owns, so
 * their words can never be mistaken for the machine's on the next run.
 */
export function landGeneratedFields(
  current: ShapeDraft,
  generated: ShapeDraft,
  authored: Record<GeneratedField, string>,
): { draft: ShapeDraft; last: GeneratedOutput } {
  const settled = {
    name: authored.name || generated.name,
    description: authored.description || generated.description,
    icon: authored.icon || generated.icon,
    classHint: authored.classHint || generated.classHint,
  };
  return {
    draft: { ...current, ...settled, members: generated.members, identityMember: generated.identityMember },
    last: {
      name: authored.name ? '' : settled.name,
      description: authored.description ? '' : settled.description,
      icon: authored.icon ? '' : settled.icon,
      classHint: authored.classHint ? '' : settled.classHint,
      members: memberSignature(generated.members),
    },
  };
}

/** What a whole-draft generation contributed: every word of it, since it replaces the draft outright. */
export const generatedOutputOf = (draft: ShapeDraft): GeneratedOutput => ({
  name: draft.name,
  description: draft.description,
  icon: draft.icon,
  classHint: draft.classHint,
  members: memberSignature(draft.members),
});

/**
 * The row id of the field that will name a record of the draft — the one chosen, or, with the
 * picker on "Work it out", the one worked out. Worked out the way the saved model will be: the draft
 * lowered as a save lowers it, then the rule every surface names a record by. So the wizard shows the
 * field a card will be headed with, not a second guess at the guess. Empty when no field qualifies.
 */
export function draftNameMemberOf(draft: ShapeDraft | null): string {
  if (!draft) return '';
  if (draft.nameMember) return draft.nameMember;
  const lowered = draftToManifest(draft, 'preview');
  if (!lowered.ok) return '';
  const entity = Object.values(lowered.manifest.entities)[0];
  const field = entity ? namePropertyOf(entity) : '';
  return draft.members.find((m) => m.kind === 'property' && m.name.trim() === field)?.rowId ?? '';
}

/** Every named property of the draft, as picker options — what both member pickers choose from. */
export const namedPropertyOptions = (draft: ShapeDraft | null): { label: string; value: string }[] =>
  (draft?.members ?? [])
    .filter((m) => m.kind === 'property' && m.name.trim())
    .map((m) => ({ label: m.name, value: m.rowId }));

/**
 * The name picker's options: "Work it out" plus every named property. "Work it out" says what it
 * worked out (`worked`, a row id), so a person sees which field heads the card.
 */
export function nameOptionsOf(draft: ShapeDraft | null, worked: string): { label: string; value: string }[] {
  const shown = draft?.nameMember ? '' : worked;
  const name = shown ? draft?.members.find((m) => m.rowId === shown)?.name.trim() : '';
  return [{ label: name ? `Work it out (${name})` : 'Work it out', value: 'none' }, ...namedPropertyOptions(draft)];
}
