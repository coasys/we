/**
 * Resolving a capability's settings across the four levels.
 *
 * Pure, so it is tested here rather than through a store: the whole of the design is which level
 * wins and what silence means, and neither needs a dataset to be wrong.
 */
import type { ModuleSetting } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import {
  clearSetting,
  type LevelValues,
  parseSettings,
  resolveGroup,
  resolveSetting,
  type SettingGroup,
  settingRows,
  writeSetting,
} from '../src/shared/moduleSettings';

const recordCalls: ModuleSetting = {
  key: 'recordCalls',
  label: 'Record calls',
  type: 'boolean',
  default: true,
  levels: ['deployment', 'space', 'agent-in-space'],
  resolution: 'restrict',
};

const language: ModuleSetting = {
  key: 'language',
  label: 'Language',
  type: 'enum',
  options: [
    { label: 'English', value: 'en' },
    { label: 'Norwegian', value: 'no' },
  ],
  default: 'en',
  levels: ['agent', 'space', 'agent-in-space'],
};

const group: SettingGroup = { id: 'transcribe', label: 'Transcription', settings: [recordCalls, language] };

describe('what a level saying nothing means', () => {
  it('is the declared default, not off', () => {
    // The rule the module lists already follow. Read as `false`, every space that predates a setting
    // would silently adopt whatever `false` means for it — which for recording is "we stopped".
    expect(resolveSetting(recordCalls, 'transcribe', {})).toEqual({
      key: 'recordCalls',
      value: true,
      source: 'default',
    });
  });

  it('survives a malformed blob rather than taking the space down', () => {
    // One bad write must not make a space unreadable, and the value it resolves to is the default
    // rather than anything inferred from the wreckage.
    expect(parseSettings('{oh dear')).toEqual({});
    expect(parseSettings('')).toEqual({});
    expect(parseSettings('["not", "an", "object"]')).toEqual({});
  });

  it('ignores a value of the wrong shape', () => {
    // A setting whose type changed, or a hand-edited blob. Silence is the honest reading: the level
    // said something the declaration cannot mean.
    const levels: LevelValues = { space: { transcribe: { recordCalls: 'yes please' } } };
    expect(resolveSetting(recordCalls, 'transcribe', levels).source).toBe('default');
  });

  it('ignores a value at a level the setting does not offer', () => {
    // Left behind by an earlier declaration that did offer it. Consulting it would let a level go on
    // deciding something it is no longer allowed to, with no screen anywhere that could correct it.
    const levels: LevelValues = { agent: { transcribe: { recordCalls: false } } };
    expect(resolveSetting(recordCalls, 'transcribe', levels).value).toBe(true);
  });
});

describe('a value setting, where the most specific level wins', () => {
  it('takes the community over this agent’s answer everywhere', () => {
    // "Here" beats "everywhere". The community's is about this space; the agent's global is about
    // every space they are in, which is a weaker claim about this one.
    const levels: LevelValues = {
      agent: { transcribe: { language: 'no' } },
      space: { transcribe: { language: 'en' } },
    };
    expect(resolveSetting(language, 'transcribe', levels)).toEqual({ key: 'language', value: 'en', source: 'space' });
  });

  it('takes this agent here over the community', () => {
    // The most specific statement anybody can make. A community choosing a value is choosing one,
    // not setting a floor — that is what `restrict` is for, and this setting is not it.
    const levels: LevelValues = {
      space: { transcribe: { language: 'en' } },
      'agent-in-space': { transcribe: { language: 'no' } },
    };
    expect(resolveSetting(language, 'transcribe', levels).value).toBe('no');
  });
});

describe('a restricted setting, which a lower level may only refuse', () => {
  it('lets a space switch it off for everyone', () => {
    const levels: LevelValues = { space: { transcribe: { recordCalls: false } } };
    const resolved = resolveSetting(recordCalls, 'transcribe', levels);

    expect(resolved.value).toBe(false);
    expect(resolved.lockedBy).toBe('space');
  });

  it('refuses to let a member switch it back on', () => {
    /*
      The whole point of the flag. Under plain specificity the member's own answer would win, and a
      community's decision not to record its calls would hold only until one person disagreed —
      which is not a setting, it is a suggestion.
    */
    const levels: LevelValues = {
      space: { transcribe: { recordCalls: false } },
      'agent-in-space': { transcribe: { recordCalls: true } },
    };
    expect(resolveSetting(recordCalls, 'transcribe', levels).value).toBe(false);
  });

  it('lets a member switch it off for themselves', () => {
    // Restriction runs downward as well: a space that records does not oblige anyone's microphone.
    const levels: LevelValues = { 'agent-in-space': { transcribe: { recordCalls: false } } };
    const resolved = resolveSetting(recordCalls, 'transcribe', levels);

    expect(resolved.value).toBe(false);
    expect(resolved.lockedBy).toBe('agent-in-space');
  });
});

describe('turning a restricted setting back on', () => {
  it('is exactly what the level that turned it off may do', () => {
    /*
      `restrict` is not "off forever". It stops a level overruling *somebody else's* refusal; whoever
      made the decision can unmake it, by flipping their own answer or by clearing it. Without this
      the flag would be a trapdoor, and the switch that closed it would be the only one in the app
      that could not be pressed twice.
    */
    const levels: LevelValues = { space: { transcribe: { recordCalls: true } } };
    const [row] = settingRows([group], 'space', levels);

    expect(row.value).toBe(true);
    expect(row.locked).toBe(false);
  });

  it('is also what clearing does, since silence is not a refusal', () => {
    expect(resolveSetting(recordCalls, 'transcribe', {}).value).toBe(true);
  });
});

describe('whose refusal binds whom', () => {
  it('does not let one member’s private answer turn the community’s control off', () => {
    /*
      The bug this rule was written for. A row used to show the *fully* resolved value, so a member
      switching recording off for their own microphone showed the community's switch as off — and it
      was enabled, so pressing it wrote the community's `true` under a refusal that outranked it and
      the switch sprang straight back. A control that lies, which is what `locked` exists to prevent
      and what showing the wrong value smuggled back in.

      The levels are two chains meeting at the deployment, not one line: a private answer says
      nothing about what a space does.
    */
    const levels: LevelValues = { 'agent-in-space': { transcribe: { recordCalls: false } } };
    const [row] = settingRows([group], 'space', levels);

    expect(row.value).toBe(true);
    expect(row.locked).toBe(false);
  });

  it('still binds that member, whatever the community decides', () => {
    // The other half, and the reason the refusal is worth anything: it holds for them.
    const levels: LevelValues = {
      space: { transcribe: { recordCalls: true } },
      'agent-in-space': { transcribe: { recordCalls: false } },
    };
    const [row] = settingRows([group], 'agent-in-space', levels);

    expect(row.value).toBe(false);
    // Their own answer, so nothing is locked — they may take it back.
    expect(row.locked).toBe(false);
  });

  it('is what a capability reads: everything in force, here, for this agent', () => {
    // No level is named, so the whole chain applies — which is the question a module is asking when
    // it reads `deps.settings`, and a different one from what any single screen shows.
    const levels: LevelValues = { 'agent-in-space': { transcribe: { recordCalls: false } } };

    expect(resolveGroup(group, levels).recordCalls).toBe(false);
  });
});

describe('what a settings screen draws', () => {
  it('offers only the settings its own level may decide', () => {
    // What makes a screen a screen: space settings asks what the community may decide, and a
    // setting that is nobody's business at this level contributes no control rather than a dead one.
    const rows = settingRows([group], 'agent', {});

    expect(rows.map((row) => row.key)).toEqual(['language']);
  });

  it('says when a value is forced from further out, rather than letting the control lie', () => {
    /*
      A switch a space has forced off looks broken without this — you press it, and it comes back.
      A disabled control that says why is the difference between a rule and a bug.
    */
    const levels: LevelValues = { space: { transcribe: { recordCalls: false } } };
    const [row] = settingRows([group], 'agent-in-space', levels);

    expect(row.locked).toBe(true);
    expect(row.lockedBy).toBe('space');
  });

  it('does not call a level’s own answer a lock on itself', () => {
    // The space screen setting `false` is that screen doing its job, not something overruling it.
    const levels: LevelValues = { space: { transcribe: { recordCalls: false } } };
    const [row] = settingRows([group], 'space', levels);

    expect(row.locked).toBe(false);
    expect(row.set).toBe(true);
  });

  it('knows whether this level holds an opinion, so a reset has something to undo', () => {
    const [row] = settingRows([group], 'space', {});
    expect(row.set).toBe(false);
  });
});

describe('writing a level’s opinion', () => {
  it('leaves the other groups and keys alone', () => {
    const before = JSON.stringify({ call: { video: false }, transcribe: { language: 'no' } });
    const after = parseSettings(writeSetting(before, 'transcribe', 'recordCalls', false));

    expect(after).toEqual({ call: { video: false }, transcribe: { language: 'no', recordCalls: false } });
  });

  it('clears back to having no opinion, rather than to a value', () => {
    // The counterpart of "absent is not off": a reset must remove the key, or the level goes on
    // deciding — with a control that now reads as untouched.
    const before = writeSetting('', 'transcribe', 'recordCalls', false);
    expect(parseSettings(clearSetting(before, 'transcribe', 'recordCalls'))).toEqual({});
  });
});

describe('what a module is handed', () => {
  it('is every declared key, resolved, with no chain left to walk', () => {
    const levels: LevelValues = { space: { transcribe: { language: 'no' } } };

    expect(resolveGroup(group, levels)).toEqual({ recordCalls: true, language: 'no' });
  });
});
