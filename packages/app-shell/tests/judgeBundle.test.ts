/**
 * What an install screen says about a bundle is worked out from its templates, never read from it.
 */
import { judgeBundle, modulesNamedBy } from '@shared/bundles/judgeBundle';
import type { Bundle } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const meta = (name: string, role?: string) => ({ name, description: '', icon: 'x', ...(role ? { role } : {}) });

const species = {
  name: 'Species',
  manifest: {
    version: '1',
    entities: {
      Species: {
        extends: 'WeNode',
        flag: { predicate: 'we://flag', value: 'we://shape/test/species' },
        properties: { name: { type: 'string', predicate: 'we://shape/test/name' } },
        relations: {},
      },
    },
  },
};

const bundle = (): Bundle =>
  ({
    format: 'we-bundle',
    formatVersion: 1,
    id: 'field-guide',
    version: '1.0.0',
    name: 'Field guide',
    description: '',
    icon: 'binoculars',
    app: {
      id: 'app',
      type: 'Column',
      meta: meta('Guide', 'app'),
      children: [
        { type: '$part', props: { id: 'host.sidebar' } },
        { type: 'we-text', children: [{ $: 'templateStore.appTemplateId' }] },
      ],
    },
    templates: [
      {
        id: 'shell',
        type: 'Column',
        meta: meta('Guide shell'),
        children: [
          { type: '$part', props: { id: 'call.startCallButton' } },
          { type: 'we-text', children: [{ $: 'modules.polls.voting' }] },
        ],
      },
      {
        id: 'map',
        type: 'Column',
        meta: { ...meta('Map', 'view'), requires: { modules: ['globe'] } },
        children: [
          { type: 'we-button', props: { onClick: { $action: 'runtimeStore.trustAgent', args: ['did:x'] } } },
          { type: 'we-text', children: [{ $: 'spaceStore.members' }] },
        ],
      },
    ],
    theme: { id: 'moss', name: 'Moss', overrides: {} },
    recordTypes: [species],
    display: { spaces: 'ours', template: 'shell' },
  }) as unknown as Bundle;

const deps = {
  requiredBy: () => [],
  hasModule: (id: string) => id === 'call' || id === 'polls',
  moduleInstalled: (id: string) => id === 'call',
  moduleName: (id: string) => ({ call: 'Calls', polls: 'Polls' })[id] ?? id,
  knownEntities: ['WeNode', 'Space', 'LocationBlock'],
};

describe('judging a bundle', () => {
  const judged = judgeBundle(bundle(), deps);

  it('lists what it adds, by name', () => {
    expect(judged.refusals).toEqual([]);
    expect(judged.adds).toEqual({
      app: 'Guide',
      spaceTemplates: ['Guide shell'],
      sections: ['Map'],
      theme: 'Moss',
      recordTypes: ['Species'],
    });
  });

  it('judges the app at the chrome tier and everything else at the space tier', () => {
    // The app reads the agent's library, which only chrome may; that is granted, and said.
    expect(judged.capabilities.join(' ')).toMatch(/templates/i);
    // A section trusting an agent is past the space tier: admitted, and reported as inert.
    expect(judged.blocked).toContain('runtimeStore.trustAgent');
    expect(judged.blocked).not.toContain('templateStore.appTemplateId');
  });

  it('splits modules into those to turn on and those this build does not have', () => {
    expect(judged.modulesToTurnOn).toEqual([{ id: 'polls', name: 'Polls' }]);
    expect(judged.modulesNotInBuild).toEqual(['globe']);
  });

  it('refuses a record type named like one that already exists, or one that does not validate', () => {
    const clash = bundle();
    clash.recordTypes = [{ ...species, name: 'Space', manifest: { version: '1', entities: { Space: {} } } }] as never;
    expect(judgeBundle(clash, deps).refusals.join(' ')).toMatch(/"Space" has the name/);

    const broken = bundle();
    broken.recordTypes = [
      { ...species, manifest: { version: '1', entities: { Species: { extends: 'Nowhere' } } } },
    ] as never;
    expect(judgeBundle(broken, deps).refusals.join(' ')).toMatch(/not a valid definition/);
  });

  it('refuses a template the renderer would not accept', () => {
    const bad = bundle();
    bad.templates![0] = { id: 'shell', type: 'Column', meta: { name: 'Bad' }, children: [42] } as never;
    expect(judgeBundle(bad, deps).refusals.join(' ')).toMatch(/not a template this app can draw/);
  });
});

describe('modules a template reaches by name', () => {
  it('finds parts, store reads and declared needs, and never a host part', () => {
    expect(
      modulesNamedBy({
        type: 'Column',
        meta: { requires: { modules: ['globe'] } },
        children: [
          { type: '$part', props: { id: 'host.rail' } },
          { type: '$part', props: { id: 'transcribe.transcriptFeed' } },
          { type: 'we-text', props: { hidden: { $: '!modules.call.active' } } },
        ],
      }).sort(),
    ).toEqual(['call', 'globe', 'transcribe']);
  });
});
