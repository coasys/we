/**
 * Which template and which theme an agent sees in a space, as the template and theme stores ask it.
 *
 * Two parties decide: the community, in the space's own record (`Space.defaultTemplateId`,
 * `defaultThemeId`), and this agent, in a private override per space (`SpacePreference.templateId`,
 * `themeId`) holding a concrete id, `AGENT_DEFAULT` ("whatever my own default is") or `FOLLOW_SPACE`.
 * The space store holds both and lends them as a `SpaceAppearance`; the template and theme stores
 * resolve what applies. The rules are the pure functions here and in `themeResolution.ts`, so they
 * can be stated and tested apart from any store.
 */
import { AGENT_DEFAULT, FOLLOW_SPACE } from '@we/entities';

import type { ThemeResolutionInput } from './themeResolution';

/** The part of a space's record the resolution reads. */
export interface SpaceAppearanceRecord {
  /** The record's own id: what an operation writing its defaults names. */
  id?: string;
  uuid?: string;
  url?: string;
  defaultTemplateId?: string;
  defaultThemeId?: string;
}

/** This agent's override for one space: a concrete id, `AGENT_DEFAULT` or `FOLLOW_SPACE` — never empty. */
export interface SpaceOverride {
  template: string;
  theme: string;
}

/** What the space store lends the template and theme stores. */
export interface SpaceAppearance {
  /** Every space record this agent has. */
  spaces: () => SpaceAppearanceRecord[];
  /** The record behind a joined dataset, by the dataset's id. */
  spaceFor: (datasetId: string) => SpaceAppearanceRecord | undefined;
  /** This agent's override for the space a dataset holds. */
  overrideFor: (datasetId: string) => SpaceOverride;
  /** Write one half of it — private to this agent, never written into the space. */
  setOverride: (datasetId: string, which: keyof SpaceOverride, id: string) => Promise<void>;
}

/**
 * The template a stored override names: `FOLLOW_SPACE` defers to the community's choice,
 * `AGENT_DEFAULT` to this agent's own, and anything else is the template. `''` when it names none.
 */
export function overrideTemplateId(override: string, spaceDefault: string | undefined, agentDefault: string): string {
  if (override === AGENT_DEFAULT) return agentDefault;
  if (override === FOLLOW_SPACE || !override) return spaceDefault || '';
  return override;
}

/** A picker option. */
export interface OverrideOption {
  label: string;
  value: string;
}

/**
 * The options of a per-space override picker, with "follow the space" and "use my default" as real
 * entries, each naming what it resolves to.
 *
 * Built in a store rather than the schema because the leading entries cannot be expressed there — a
 * schema can map a store array into options, but has no way to prepend one. And they have to exist:
 * without them overriding is one-way, since a picker offering only concrete choices gives someone no
 * way back to the space's own.
 */
export function overrideOptions(input: {
  choices: OverrideOption[];
  spaceDefaultName: string | undefined;
  agentDefaultName: string | undefined;
}): OverrideOption[] {
  const withResolved = (label: string, name: string | undefined) => (name ? `${label} (${name})` : label);
  return [
    { label: withResolved("Use the space's default", input.spaceDefaultName), value: FOLLOW_SPACE },
    { label: withResolved('Use my default', input.agentDefaultName), value: AGENT_DEFAULT },
    ...input.choices,
  ];
}

/**
 * Everything the theme precedence needs for one space, from plain values.
 *
 * `onScreenTemplate` is the template **actually rendering** when the space is the one on screen, and
 * undefined otherwise. It, rather than the override, says whether the template in use is the
 * space's: the switcher changes template without touching the override, and the suggestion has to
 * follow what is drawn. For a space not on screen there is nothing rendering to compare, so the
 * override says what would apply there — and there is no suggestion to read.
 */
export function themeResolutionInputOf(input: {
  override: SpaceOverride;
  space: SpaceAppearanceRecord | undefined;
  onScreenTemplate: { id?: string; themeId?: string } | undefined;
  /** Whether this agent lets a template bring the theme it was designed for. */
  useTemplateTheme: boolean;
  /** Whether this agent has the theme a template names. */
  hasTheme: (id: string) => boolean;
  agentTheme: string;
}): ThemeResolutionInput {
  const { override, space, onScreenTemplate } = input;
  const suggested = onScreenTemplate?.themeId ?? '';
  return {
    themeOverride: override.theme,
    templateIsSpaceDefault: onScreenTemplate
      ? onScreenTemplate.id === (space?.defaultTemplateId || '')
      : override.template === FOLLOW_SPACE,
    spaceTheme: space?.defaultThemeId || '',
    /*
      A suggestion naming a theme this agent does not have resolves to nothing rather than failing,
      mirroring how a link's `?theme=` degrades; the store says so once.
    */
    templateTheme: input.useTemplateTheme && suggested && input.hasTheme(suggested) ? suggested : '',
    agentTheme: input.agentTheme,
    agentDefaultSentinel: AGENT_DEFAULT,
    followSpaceSentinel: FOLLOW_SPACE,
  };
}
