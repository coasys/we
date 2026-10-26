/**
 * GENERATED from src/manifest/Policy.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

/**
 * One version of a space's rules: who may do what to its records.
 *
 * The rules themselves are the policy format in `@we/backend-shared` (`Policy`), kept whole as one
 * document. A space without any reads as the open preset: everybody who has joined may do anything,
 * and only admins change the rules or hand out roles.
 *
 * ## Versions, never edits
 *
 * Changing the rules writes a new record rather than editing this one, and the newest version wins —
 * but only a version written by somebody the version before it allowed to change the rules
 * (`Policy.edit`). Each one is judged by the policy it replaces, never by itself: otherwise a version
 * granting its own author the right to write it would approve itself. Who wrote each version and
 * when come from the base, so the space's rules carry their own history.
 *
 * Rules live in the space rather than in a template because a template is a view any member with
 * edit rights can change and a space can switch: rules kept there would protect nothing and vanish
 * with the template. Kept here, they survive a template switch, a fork and an export.
 *
 * ## Why the plain base rather than `WeNode`
 *
 * Vocabulary, like {@link Role}: a version of the rules is not something people reply to or react to.
 */
@Model({ name: 'Policy' })
export class Policy extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://policy' })
  flag: string = '';

  /** The rules, as the policy format's JSON. Read leniently: a permission that does not parse is dropped. */
  @Property({ through: 'we://policy_document', required: true })
  document: string = '';
}
