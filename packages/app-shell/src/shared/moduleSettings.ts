/**
 * What a capability's settings are here, given what every level had to say.
 *
 * ## The gap this fills
 *
 * A module can be turned on and off four ways and could not carry a single *value*. So a capability
 * that needed one put it on the space: `autoInterpret`, `extractionTargets` and
 * `shareExtractionDetail` are all settings of the extraction pass, and all three are columns on the
 * core `Space` entity — each with an accessor, a setter and a hand-written row in the settings
 * panel. Recording would have been the fourth. A core entity growing a field on behalf of a
 * capability is a workaround that had recurred often enough to be the design.
 *
 * ## Availability intersects; settings do not
 *
 * Worth stating because getting it wrong would make the whole thing useless. Whether a module runs
 * here is four answers to one boolean — registered ∩ installed ∩ enabled, less muted — and every
 * layer can only subtract, because "available" is the kind of thing anyone may withhold.
 *
 * A setting is a value. "Which entities does extraction write", "is a call recorded by default":
 * those resolve by **specificity**, most specific level wins, because a community choosing a value
 * is choosing it rather than setting a floor. AND-ing them would make it impossible to express
 * anything but a boolean, and impossible to express *that* except as a veto.
 *
 * The veto is real for some settings though, so it is declared per setting rather than assumed:
 * {@link SettingResolution} `restrict` is the AND, for the ones where a lower level must not be able
 * to undo a higher one. A space that has switched recording off is not overridable by a member.
 *
 * ## Absent is not off
 *
 * The same rule the module lists already follow, and the reason both are strings rather than
 * booleans on the wire: a level that has never been touched has **no opinion**, and reading that as
 * `false` would mean every space that predates a setting silently adopting whatever `false` means
 * for it. Only a value somebody wrote counts as an answer.
 */
import type { ModuleSetting, SettingLevel } from '@we/module-shared';

/** A capability's settings, and who it is. A module's group id is its module id. */
export interface SettingGroup {
  id: string;
  label: string;
  description?: string;
  settings: readonly ModuleSetting[];
}

/** What one level had to say: `{ [group]: { [key]: value } }`. Absent keys are silence. */
export type SettingValues = Record<string, Record<string, unknown>>;

export type SettingValue = boolean | string | number;

/**
 * The order levels resolve in, least specific first.
 *
 * The deployment is the base — what this build ships believing. Then the agent's own preference
 * everywhere, then the community's decision here, then the agent's decision *here*, which is the
 * most specific statement anyone can make and so wins.
 *
 * Community above agent-global is the one that looks arguable and is not: the community's is about
 * this space, the agent's global is about every space, and "here" beats "everywhere". Where the
 * community's answer must not be overridable at all, that is `restrict`, not an ordering.
 */
export const SETTING_LEVELS: readonly SettingLevel[] = ['deployment', 'agent', 'space', 'agent-in-space'];

/** One resolved setting, and where its value came from. */
export interface ResolvedSetting {
  key: string;
  value: SettingValue;
  /** The level that decided it, or `'default'` when nobody had an opinion. */
  source: SettingLevel | 'default';
  /**
   * The level holding a `restrict` value that a more specific level cannot undo, if any.
   *
   * What a control reads to explain itself. Without it a switch a space has forced off looks broken
   * — you press it, and it comes back — which is worse than a disabled switch saying why.
   */
  lockedBy?: SettingLevel;
}

/** Values keyed by level, as the host reads them out of its four stores. */
export type LevelValues = Partial<Record<SettingLevel, SettingValues>>;

/**
 * Parse a stored settings blob.
 *
 * Empty, absent and malformed all mean the same thing — **no opinion** — because the alternative is
 * one bad write making a space unreadable. A malformed blob is reported rather than swallowed: it
 * is a bug somewhere upstream, and silence about it is how it survives.
 */
export function parseSettings(raw: string | null | undefined, describe = 'module settings'): SettingValues {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SettingValues = {};
    for (const [group, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (values && typeof values === 'object' && !Array.isArray(values)) out[group] = { ...(values as object) };
    }
    return out;
  } catch {
    console.warn(`${describe} is not valid JSON; reading it as no opinion`);
    return {};
  }
}

/** Write one value into a settings blob, returning the JSON to store. */
export function writeSetting(raw: string | null | undefined, group: string, key: string, value: SettingValue): string {
  const parsed = parseSettings(raw);
  const next: SettingValues = { ...parsed, [group]: { ...(parsed[group] ?? {}), [key]: value } };
  return JSON.stringify(next);
}

/** Remove one value, so that level goes back to having no opinion. */
export function clearSetting(raw: string | null | undefined, group: string, key: string): string {
  const parsed = parseSettings(raw);
  const values = { ...(parsed[group] ?? {}) };
  delete values[key];
  const next: SettingValues = { ...parsed };
  if (Object.keys(values).length) next[group] = values;
  else delete next[group];
  return JSON.stringify(next);
}

/** The last entry, or undefined. Written out because the app hosts target a library without `at`. */
function last<T>(items: readonly T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}

/** Whether a stored value is usable for a setting of this shape. A wrong type is silence. */
function admissible(setting: ModuleSetting, value: unknown): value is SettingValue {
  if (setting.type === 'boolean') return typeof value === 'boolean';
  if (setting.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (setting.type === 'enum') {
    return typeof value === 'string' && (setting.options ?? []).some((option) => option.value === value);
  }
  return typeof value === 'string';
}

/**
 * Which levels an answer at one level has to live with.
 *
 * Not simply "everything less specific", which is what it looked like and is wrong in one direction
 * that matters. **A member's private refusal does not bind the community**: one person switching
 * recording off for their own microphone says nothing about what the space does, so the community's
 * own control must go on showing — and writing — the community's answer. The same for an agent's
 * global preference, which one space's decision does not overrule everywhere.
 *
 * So the levels form two chains that meet at the deployment rather than one line:
 *
 * - the community answers to the deployment
 * - an agent's answer everywhere answers to the deployment
 * - an agent's answer *here* answers to all three, because all three apply to them in this space
 *
 * Read for two purposes, and both are the same question — what is true for the people this level
 * speaks for: the value a screen shows, and whether a refusal it cannot undo has already been made.
 */
const BINDING: Record<SettingLevel, readonly SettingLevel[]> = {
  deployment: ['deployment'],
  agent: ['deployment', 'agent'],
  space: ['deployment', 'space'],
  'agent-in-space': ['deployment', 'agent', 'space', 'agent-in-space'],
};

/**
 * Resolve one setting.
 *
 * `restrict` is an AND over every level that spoke, *including the default* — so a setting that
 * defaults off cannot be turned on by any level, which is the honest reading of "levels may only
 * restrict this". `override` takes the last level with an admissible opinion.
 *
 * `speakingFor` narrows it to what is true for the people one level speaks for. Absent, it is the
 * whole chain — what is actually in force for this agent in this space, which is what a capability
 * reading `deps.settings` wants. A *screen* passes its own level, because a control that showed the
 * fully resolved answer would show a community switch turned off by one member's private preference,
 * and pressing it would write the community's `true` under a refusal that outranks it: a switch that
 * springs back, which is the failure `lockedBy` exists to make impossible.
 */
export function resolveSetting(
  setting: ModuleSetting,
  group: string,
  levels: LevelValues,
  speakingFor?: SettingLevel,
): ResolvedSetting {
  const consulted = speakingFor ? BINDING[speakingFor] : SETTING_LEVELS;
  const spoken: { level: SettingLevel; value: SettingValue }[] = [];
  for (const level of SETTING_LEVELS) {
    // A level that may not decide this setting is not consulted, so a stale value left behind by an
    // earlier declaration cannot go on deciding something it is no longer allowed to.
    if (!setting.levels.includes(level) || !consulted.includes(level)) continue;
    const value = levels[level]?.[group]?.[setting.key];
    if (admissible(setting, value)) spoken.push({ level, value });
  }

  if (setting.resolution === 'restrict') {
    const denier = spoken.find((entry) => entry.value === false);
    if (setting.default === false || !spoken.length) {
      return { key: setting.key, value: setting.default, source: last(spoken)?.level ?? 'default' };
    }
    return denier
      ? { key: setting.key, value: false, source: denier.level, lockedBy: denier.level }
      : { key: setting.key, value: true, source: last(spoken)?.level ?? 'default' };
  }

  const decided = last(spoken);
  return decided
    ? { key: setting.key, value: decided.value, source: decided.level }
    : { key: setting.key, value: setting.default, source: 'default' };
}

/** Every setting of one group, resolved. What a module's `deps.settings` answers with. */
export function resolveGroup(group: SettingGroup, levels: LevelValues): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const setting of group.settings) out[setting.key] = resolveSetting(setting, group.id, levels).value;
  return out;
}

/** A row a settings screen draws: the declaration, the answer, and where the answer came from. */
export interface SettingRow extends ResolvedSetting {
  group: string;
  groupLabel: string;
  label: string;
  description?: string;
  type: ModuleSetting['type'];
  options?: readonly { label: string; value: string }[];
  /** Whether this level currently holds an opinion of its own, so a reset has something to undo. */
  set: boolean;
  /** True when a `restrict` level above has forced the value — the control says so and is disabled. */
  locked: boolean;
}

/**
 * The rows a screen for one level renders.
 *
 * Filtered by the level rather than by the group, because that is what a screen is: space settings
 * asks "what may this community decide", global settings asks "what may I decide everywhere". A
 * group with nothing at that level contributes no section rather than an empty one.
 */
export function settingRows(groups: readonly SettingGroup[], level: SettingLevel, levels: LevelValues): SettingRow[] {
  const rows: SettingRow[] = [];
  for (const group of groups) {
    for (const setting of group.settings) {
      if (!setting.levels.includes(level)) continue;
      // Resolved for the people this screen speaks for — see `BINDING`. A community switch must show
      // the community's answer, not one turned off by a member's private preference.
      const resolved = resolveSetting(setting, group.id, levels, level);
      rows.push({
        ...resolved,
        group: group.id,
        groupLabel: group.label,
        label: setting.label,
        ...(setting.description ? { description: setting.description } : {}),
        type: setting.type,
        ...(setting.options ? { options: setting.options } : {}),
        set: admissible(setting, levels[level]?.[group.id]?.[setting.key]),
        /*
          A refusal this screen cannot undo.

          Only from a level that binds it, and only from a level that is not *its own* — a `restrict`
          value set here is what this screen just did rather than something overruling it. Everything
          else is enabled, including a control whose answer some more specific level does not follow:
          the community may decide what it decides, whether or not one member has opted out of it.
        */
        locked: Boolean(resolved.lockedBy && resolved.lockedBy !== level),
      });
    }
  }
  return rows;
}
