/**
 * The module catalogue in the validator — what a schema may name of a module, checked.
 *
 * Every one of these used to be silent: `modules.transcribe.typo` validated clean and rendered
 * nothing, a `$part` naming nobody warned once in a console, a `meta.panels` entry naming a panel a
 * module does not have fell back to the module's own bid. With a catalogue in the context each is a
 * message with the nearest right name.
 */
import { describe, expect, it } from 'vitest';

import type { ContextData, ModuleCatalogEntry } from './contextTypes';
import { buildValidationContext, validateSemantic, withOwnModule } from './semanticValidation';

const polls: ModuleCatalogEntry = {
  id: 'polls',
  name: 'Polls',
  scope: 'space',
  requires: { kernels: ['records'] },
  capabilities: [],
  members: [
    { name: 'voting', kind: 'state', doc: 'x' },
    { name: 'vote', kind: 'action', doc: 'x' },
  ],
  parts: [{ name: 'pollCard' }],
  panels: [],
  launchers: [],
  settings: [],
  activities: {},
  components: ['PollChart'],
  functions: [{ name: 'tally', params: ['options'], doc: 'x', example: 'tally({})' }],
  views: [],
  blocks: [],
  entities: [{ name: 'Poll', className: 'Poll', fields: [], relations: [] }],
};

const transcribe: ModuleCatalogEntry = {
  ...polls,
  id: 'transcribe',
  name: 'Transcription',
  members: [{ name: 'open', kind: 'state', doc: 'x' }],
  parts: [],
  panels: [
    { name: 'transcript', title: 'Transcript', hostOwned: false },
    { name: 'extraction', title: 'Extraction', hostOwned: false },
  ],
  components: [],
  functions: [],
  entities: [],
};

const data: ContextData = {
  primitives: [{ tagName: 'we-text', className: 'WeText', ownProps: [] }],
  components: [{ name: 'Column', props: [], source: 'components' }],
  models: [],
  tokens: [],
  storeEntries: [],
  modules: [polls, transcribe],
};

const ctx = buildValidationContext(data);

const template = (node: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({
  type: 'Column',
  meta: { name: 't', description: '', icon: '', ...meta },
  children: [node],
});

const messages = (result: { errors: { message: string }[] }) => result.errors.map((e) => e.message);

describe('module store references', () => {
  it('accepts a public member and refuses an unknown one, with a suggestion', () => {
    expect(
      messages(validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.polls.voting' }] }), ctx)),
    ).toEqual([]);
    const bad = validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.polls.votin' }] }), ctx);
    expect(messages(bad)[0]).toContain('Unknown member "votin" on modules.polls');
    expect(messages(bad)[0]).toContain('modules.polls.voting');
  });

  it('refuses a module this deployment does not ship, naming the ones it does', () => {
    const bad = validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.notes.open' }] }), ctx);
    expect(messages(bad)[0]).toContain('Unknown module "notes"');
    expect(messages(bad)[0]).toContain('polls, transcribe');
  });

  it('allows the bare module read that depends on an optional module', () => {
    expect(messages(validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.polls' }] }), ctx))).toEqual(
      [],
    );
  });

  it('checks an $action the same way, one segment deeper', () => {
    const ok = validateSemantic(
      template({ type: 'we-text', props: { onClick: { $action: 'modules.polls.vote' } } }),
      ctx,
    );
    expect(messages(ok)).toEqual([]);
    const bad = validateSemantic(
      template({ type: 'we-text', props: { onClick: { $action: 'modules.polls.vot' } } }),
      ctx,
    );
    expect(messages(bad)[0]).toContain('Unknown action "vot" on modules.polls');
  });

  it('leaves everything unchecked when the context carries no catalogue', () => {
    const lenient = buildValidationContext({ ...data, modules: undefined });
    expect(
      messages(validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.anything.at.all' }] }), lenient)),
    ).toEqual([]);
  });

  it('lets a module’s own chrome read its private members', () => {
    // Private means private to the module's own chrome, which renders against the chrome bag.
    const own = withOwnModule(ctx, 'polls');
    expect(
      messages(validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.polls.secret' }] }), own)),
    ).toEqual([]);
    // Another module's members are still public-only from there.
    expect(
      messages(validateSemantic(template({ type: 'we-text', children: [{ $: 'modules.transcribe.secret' }] }), own)),
    ).toHaveLength(1);
  });
});

describe('what a module adds to the vocabulary', () => {
  it('makes its entities queryable, its functions callable and its components mountable', () => {
    const schema = template({
      type: 'PollChart',
      $queries: { polls: { entity: 'Poll' } },
      props: { rows: { $: 'tally({ votes: local.polls })' } },
    });
    expect(messages(validateSemantic(schema, ctx))).toEqual([]);
  });
});

describe('$part', () => {
  it('accepts a published part and refuses one nobody publishes', () => {
    expect(messages(validateSemantic(template({ type: '$part', props: { id: 'polls.pollCard' } }), ctx))).toEqual([]);
    const bad = validateSemantic(template({ type: '$part', props: { id: 'polls.pollCrd' } }), ctx);
    expect(messages(bad)[0]).toContain('No module publishes part "polls.pollCrd"');
    expect(messages(bad)[0]).toContain('polls.pollCard');
  });

  it('insists on the <module>.<part> shape whatever the catalogue says', () => {
    const lenient = buildValidationContext({ ...data, modules: undefined });
    expect(messages(validateSemantic(template({ type: '$part', props: { id: 'pollCard' } }), lenient))[0]).toContain(
      '"<moduleId>.<partName>"',
    );
  });
});

describe('meta.panels and meta.requires', () => {
  it('checks a placed panel against the module’s panel names', () => {
    const ok = validateSemantic(
      template({ type: 'we-text' }, { panels: [{ id: 'a', module: 'transcribe', dock: 'transcript' }] }),
      ctx,
    );
    expect(messages(ok)).toEqual([]);
    const bad = validateSemantic(
      template({ type: 'we-text' }, { panels: [{ id: 'a', module: 'transcribe', dock: 'transcrip' }] }),
      ctx,
    );
    expect(messages(bad)[0]).toContain('no panel named "transcrip"');
  });

  it('asks for a dock name when the module has several panels', () => {
    const bad = validateSemantic(template({ type: 'we-text' }, { panels: [{ id: 'a', module: 'transcribe' }] }), ctx);
    expect(messages(bad)[0]).toContain('name one with "dock"');
  });

  it('warns about a required module the deployment does not ship', () => {
    const result = validateSemantic(template({ type: 'we-text' }, { requires: { modules: ['polls', 'notes'] } }), ctx);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe('warning');
    expect(result.errors[0].message).toContain('"notes"');
  });
});
