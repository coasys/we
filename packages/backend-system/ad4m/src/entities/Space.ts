/**
 * GENERATED from src/manifest/Space.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { fileToDataUri, Flag, HasOne, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';

import { LocationBlock } from './LocationBlock';
import { WeNode } from './WeNode';

@Model({ name: 'Space' })
export class Space extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space' })
  flag: string = '';

  @Property({ through: 'we://uuid' })
  uuid: string = '';

  @Property({ through: 'we://url' })
  url?: string;

  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://description', required: true })
  description: string = '';

  @Property({ through: 'we://discovery' })
  discovery: string = 'hidden';

  @Property({ through: 'we://image', resolveLanguage: FILE_STORAGE_LANGUAGE, transform: fileToDataUri })
  avatar?: string;

  @Property({ through: 'we://thumbnail', resolveLanguage: FILE_STORAGE_LANGUAGE, transform: fileToDataUri })
  coverImage?: string;

  @Property({ through: 'we://default_template_id' })
  defaultTemplateId: string = '';

  @Property({ through: 'we://default_theme_id' })
  defaultThemeId: string = '';

  /**
   * Which feature modules this community has turned on, as a JSON array of module ids.
   *
   * **Empty means "not decided", not "none".** A space created before this field existed, or by an
   * agent who never opened the setting, must keep rendering the chrome it always had — so an unset
   * value falls back to the modules the deployment's seed activated. Treating empty as "none" would
   * silently strip existing spaces of every module the moment this shipped.
   *
   * A JSON string rather than a relation because the values are ids from the seed, not entities in
   * the perspective — the same shape `AgentSettings.datasetOrder` uses for an ordered id list.
   */
  @Property({ through: 'we://enabled_modules' })
  enabledModules: string = '';

  /**
   * Which sections this community's spaces have, and in what order — a JSON array of view ids.
   *
   * The community's decision, exactly as `enabledModules` is: every member sees the same
   * sections, because "what is in this space" is a fact about the space rather than a preference
   * about it. An agent's own hiding lives in `SpacePreference.hiddenViews`, which is private.
   *
   * **Empty means "not decided", not "none"** — the same rule, and it exists for the same
   * reason. A space that predates views must show the sections it always had, so an unset value
   * falls back to the deployment's bundled set in seed order. Reading empty as "none" would land
   * as every existing space silently losing every tab.
   *
   * Ordered, and the order is the nav order: this is the one field a community reorders its own
   * sections by. A JSON string rather than a relation because the values are ids from a registry
   * or a marketplace, not entities in the perspective — the shape `datasetOrder` already uses.
   */
  @Property({ through: 'we://enabled_views' })
  enabledViews: string = '';

  /**
   * Which candidate models this community's calls start out extracting, as a JSON array of
   * entity names.
   *
   * The middle of three layers. `EntitySchema.extractable` says what is a candidate at all —
   * a question about whether an LLM *could* mint one, answered by the codebase; this says which
   * of them a call here begins with, which is a question about what this community's
   * conversations are about and is nobody else's to answer. A call may then add or remove for
   * itself (`CallExtraction`).
   *
   * **Empty means "not decided", not "none"** — the `enabledModules` rule, and it matters more
   * here than anywhere: reading empty as none would make every space that predates this field
   * silently stop extracting, with nothing on screen to say why. An unset value falls back to
   * the two classes that were hardcoded before this existed (`TaskBlock`, `EventBlock`), so
   * nothing regresses; the first toggle writes the resolved list and the community owns it
   * thereafter.
   *
   * A JSON string rather than a relation because the values are entity *names* — there is
   * nothing in the perspective to point at. Same shape as `enabledModules` and `enabledViews`.
   */
  @Property({ through: 'we://extraction_targets' })
  extractionTargets: string = '';

  @Property({ through: 'we://auto_interpret' })
  autoInterpret: boolean = false;

  /**
   * Whether extraction passes broadcast their prompt and response to the rest of the space.
   *
   * A property of the space for the same reason `autoInterpret` is, though a different one than
   * might be assumed. It is not about secrecy: in a call the prompt is built from a transcript
   * every participant already holds, so a member sharing theirs reveals nothing the others lack.
   *
   * It is about the state being *collective*. "I share and you do not" is an asymmetry with no
   * use — the reason to turn this on is that a space is working on extraction and wants to see
   * what it is doing, which is a decision about the space rather than about one member.
   *
   * Defaults off because the payload is tens of KB per pass and rides the ephemeral signalling
   * transport, which exists for small last-write-wins messages. That is a poor default to impose
   * on every space forever, and a very reasonable thing to switch on for an afternoon.
   */
  @Property({ through: 'we://share_extraction_detail' })
  shareExtractionDetail: boolean = false;

  @HasOne(() => LocationBlock, { through: 'we://location' })
  location?: LocationBlock;
}

export interface Space {
  /** Generated by @HasOne — links a new LocationBlock as this space's location. */
  setLocation(value: LocationBlock): Promise<void>;
}
