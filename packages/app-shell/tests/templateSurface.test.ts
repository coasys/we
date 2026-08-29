/**
 * The trust boundary, guarded.
 *
 * `templateSurface.ts` is an allowlist that lives beside the thing it allows, which is the shape
 * that always rots: someone adds a store member, nobody classifies it, and it is either silently
 * exposed or silently missing depending on which way the default falls. Here the default is
 * "absent", so drift fails closed — but a member that should have been template vocabulary and is
 * quietly missing is its own bug, and neither is something to find out about from a user.
 *
 * So the interfaces are read off the source and every member must be accounted for. Adding one to a
 * store fails this until it is classified, which is the only way an allowlist stays true.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildTemplateBag,
  CAPABILITY_GROUPS,
  CHROME_TIER,
  SPACE_TIER,
  TEMPLATE_SURFACE,
} from '../src/shared/registries/templateSurface';

const storesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/frameworks/solid/stores');

/** Members declared on each `export interface …Store`, read from the source. */
function declaredMembers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readdirSync(storesDir)) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
    const source = readFileSync(join(storesDir, file), 'utf8');
    const match = /export interface (\w+Store) \{([\s\S]*?)\n\}/.exec(source);
    if (!match) continue;
    const [, name, body] = match;
    // Two-space indent is a member of this interface; deeper is a member of a nested object type.
    const members = [...body.matchAll(/^ {2}(\w+)\??\s*[:(]/gm)].map((m) => m[1]);
    const key = name[0].toLowerCase() + name.slice(1);
    found.set(key, [...new Set(members)]);
  }
  return found;
}

const declared = declaredMembers();

describe('the surface manifest describes the stores that exist', () => {
  it('reads a non-trivial set of stores, so the checks below mean something', () => {
    // Guards the guard: a renamed interface or a moved directory would otherwise make every
    // assertion below pass by finding nothing at all.
    expect(declared.size).toBeGreaterThanOrEqual(12);
    expect(declared.get('spaceStore')?.length).toBeGreaterThan(30);
  });

  it('classifies every member of every store', () => {
    const unclassified: string[] = [];
    for (const [store, members] of declared) {
      const spec = TEMPLATE_SURFACE[store];
      if (!spec) {
        unclassified.push(`${store}: the whole store is unclassified`);
        continue;
      }
      for (const member of members) {
        if (!(member in spec)) unclassified.push(`${store}.${member}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it('classifies nothing that no longer exists', () => {
    const stale: string[] = [];
    for (const [store, spec] of Object.entries(TEMPLATE_SURFACE)) {
      const members = declared.get(store);
      if (!members) continue; // `record` is assembled in the provider, not declared as an interface.
      for (const member of Object.keys(spec)) {
        if (!members.includes(member)) stale.push(`${store}.${member}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('names a real group for every classified member', () => {
    const groups = new Set(Object.keys(CAPABILITY_GROUPS));
    for (const [store, spec] of Object.entries(TEMPLATE_SURFACE)) {
      for (const [member, value] of Object.entries(spec)) {
        if (value === 'wiring') continue;
        expect(groups, `${store}.${member}`).toContain(value.group);
      }
    }
  });
});

describe('what the space tier can reach', () => {
  /** A stand-in bag with one member per classified name, so filtering is observable. */
  const fakeStores = Object.fromEntries(
    Object.entries(TEMPLATE_SURFACE).map(([store, spec]) => [
      store,
      Object.fromEntries(Object.keys(spec).map((member) => [member, () => member])),
    ]),
  );

  const spaceBag = buildTemplateBag(fakeStores, { grants: SPACE_TIER });
  const chromeBag = buildTemplateBag(fakeStores, { grants: CHROME_TIER });

  const reaches = (bag: Record<string, unknown>, path: string) => {
    const [store, member] = path.split('.');
    return member in ((bag[store] ?? {}) as Record<string, unknown>);
  };

  it('cannot reach the things that made this necessary', () => {
    // Every one of these was reachable from a marketplace template before this existed.
    for (const path of [
      'runtimeStore.trustAgent',
      'runtimeStore.importDatabase',
      'runtimeStore.restartExecutor',
      'accountStore.removeAccount',
      'sessionStore.logout',
      'spaceStore.removeSpace',
      'templateStore.deleteTemplate',
      'themeStore.deleteTheme',
      'profileStore.updateOwnProfile',
    ]) {
      expect(reaches(spaceBag, path), path).toBe(false);
    }
  });

  it('cannot reach a credential or a backend handle at any tier', () => {
    // The exfiltration path: `agentSettings` carries the Claude API key, and the dataset handles are
    // what a `$query`'s `dataset` option resolves against — so leaving those would be the same leak
    // by another route.
    for (const path of [
      'sessionStore.token',
      'sessionStore.port',
      'sessionStore.serverUrl',
      'sessionStore.backendPorts',
      'datasetStore.agentSettings',
      'editorStore.setApiKey',
    ]) {
      expect(reaches(spaceBag, path), `space: ${path}`).toBe(false);
      expect(reaches(chromeBag, path), `chrome: ${path}`).toBe(false);
    }
  });

  it('keeps the agent root dataset for chrome, and away from a space', () => {
    /*
      A handle to the agent's own perspective is what a `$query`'s `dataset` resolves against, and
      `AgentSettings` — which lives there — carries the Claude API key. So a space's template must
      not hold one.

      Chrome must, though: the settings page marks which row in the datasets list is your root by
      comparing ids against it. Grouping it with the credentials meant it was unreachable
      everywhere, and that switch quietly stopped working.
    */
    expect(reaches(spaceBag, 'datasetStore.rootDataset')).toBe(false);
    expect(reaches(chromeBag, 'datasetStore.rootDataset')).toBe(true);
  });

  it('can still render and take part in a space', () => {
    for (const path of [
      'spaceStore.currentSpace',
      'spaceStore.createPost',
      'spaceStore.upsertSignal',
      'spaceStore.members',
      'spaceStore.unreadNodeIds',
      'spaceStore.myMentions',
      'spaceStore.uploadFile',
      'presenceStore.onlineHere',
      'routeStore.navigate',
      'routeStore.setParam',
      'profileStore.profiles',
      'record.create',
    ]) {
      expect(reaches(spaceBag, path), path).toBe(true);
    }
  });

  it('gives chrome what it needs to be the app', () => {
    for (const path of [
      'runtimeStore.trustAgent',
      'accountStore.switchAccount',
      'spaceStore.removeSpace',
      'templateStore.installFromMarketplace',
      'themeStore.setCurrentTheme',
      'editorStore.sendMessage',
    ]) {
      expect(reaches(chromeBag, path), path).toBe(true);
    }
  });

  it('never puts host wiring in either bag', () => {
    for (const [store, spec] of Object.entries(TEMPLATE_SURFACE)) {
      for (const [member, value] of Object.entries(spec)) {
        if (value !== 'wiring') continue;
        expect(reaches(chromeBag, `${store}.${member}`), `${store}.${member}`).toBe(false);
      }
    }
  });
});

describe('destructive actions', () => {
  it('can be refused by the host without the template knowing how', () => {
    const removed: string[] = [];
    const asked: string[] = [];
    const bag = buildTemplateBag(
      { spaceStore: { removeSpace: (id: string) => removed.push(id), createPost: () => removed.push('post') } },
      {
        grants: CHROME_TIER,
        onDestructive: (path) => {
          asked.push(path);
          return false;
        },
      },
    );

    const spaceStore = bag.spaceStore as Record<string, (arg: string) => unknown>;
    spaceStore.removeSpace('space-1');
    spaceStore.createPost('x');

    // The guard is consulted for the destructive one and nothing else, and refusing means the
    // method never runs — the template gets `undefined`, the same as any action it cannot reach.
    expect(asked).toEqual(['spaceStore.removeSpace']);
    expect(removed).toEqual(['post']);
  });
});

describe('space-configuring actions are pinned to the space on screen', () => {
  /*
    Every one of these takes the space as a trailing optional argument, omitted meaning "here". The
    default is right for a template and the argument is not: it is the difference between "this
    community's template configures this community" and "any space you visit can rename every other
    space you are in". The tier grants the action; this is what makes granting it safe.
  */
  const calls: unknown[][] = [];
  const record =
    (..._names: string[]) =>
    (...args: unknown[]) => {
      calls.push(args);
    };

  const bag = buildTemplateBag(
    {
      spaceStore: {
        updateSpaceMeta: record(),
        setSpaceDefaultTemplate: record(),
        setModuleEnabled: record(),
        updateSpaceImage: record(),
      },
    },
    { grants: SPACE_TIER },
  );
  const spaceStore = bag.spaceStore as Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    calls.length = 0;
  });

  it('drops a spaceUuid a template tries to name', () => {
    spaceStore.updateSpaceMeta({ name: 'Renamed' }, 'someone-elses-space');
    expect(calls).toEqual([[{ name: 'Renamed' }]]);
  });

  it('keeps every argument the action legitimately takes', () => {
    spaceStore.setModuleEnabled('call', true, 'someone-elses-space');
    expect(calls).toEqual([['call', true]]);
  });

  it('leaves an ordinary call untouched', () => {
    spaceStore.setSpaceDefaultTemplate('gardening');
    spaceStore.updateSpaceImage('avatar', 'a-file');
    expect(calls).toEqual([['gardening'], ['avatar', 'a-file']]);
  });

  /*
    The chrome tier holds `space-admin`, which is this restriction's own sentence negated: "change
    settings in spaces other than this one". Settings' per-space page is what that grant is for — it
    configures a space you are not standing in, naming it by the row that was clicked. Truncated
    there, every control on the page wrote to whichever space was on screen instead, which is worse
    than refusing: it silently renamed the wrong space and reported success.
  */
  it('lets a bag granted space-admin name the space it means', () => {
    const chrome = buildTemplateBag(
      { spaceStore: { updateSpaceMeta: record(), setModuleEnabled: record() } },
      {
        grants: CHROME_TIER,
      },
    ).spaceStore as Record<string, (...args: unknown[]) => unknown>;

    chrome.updateSpaceMeta({ name: 'Renamed' }, 'another-space');
    chrome.setModuleEnabled('call', true, 'another-space');
    expect(calls).toEqual([
      [{ name: 'Renamed' }, 'another-space'],
      ['call', true, 'another-space'],
    ]);
  });
});
