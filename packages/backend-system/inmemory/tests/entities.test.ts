/**
 * The core vocabulary, running on rows.
 *
 * These are the real `CORE_MANIFEST` entities — the same declaration the AD4M adapter compiles
 * into decorated classes — compiled here into something backed by arrays. What the suite is
 * checking is that the declaration carries enough to *be* an entity: identity, declared starting
 * values, relations in both directions, and the query shapes stores actually issue.
 *
 * Where a manifest turns out to be missing something, this is where it shows up, because nothing
 * here can fall back on knowledge the AD4M classes happen to encode.
 */
import { CORE_MANIFEST } from '@we/entities/manifest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compileEntities } from '../src/entities';

const runtime = { selfId: () => 'did:test:me' };
const entities = compileEntities(CORE_MANIFEST, runtime);

const Space = entities.Space;
const Template = entities.Template;
const ImageBlock = entities.ImageBlock;
const AgentSettings = entities.AgentSettings;
const SignalType = entities.SignalType;
const Signal = entities.Signal;

let dataset: { id: string; tables: Record<string, unknown[]> };

beforeEach(() => {
  dataset = { id: 'ds-1', tables: {} };
});

describe('what the declaration is enough to build', () => {
  it('compiles every entity the manifest declares', () => {
    expect(Object.keys(entities).sort()).toEqual(Object.keys(CORE_MANIFEST.entities).sort());
  });

  it('gives a created entity identity and authorship without being told to', () => {
    // `author` is not a declared property — it is what any entity has by virtue of being written
    // by someone, and templates filter on it (`$me.did`). A backend that didn't supply it would
    // look fine until an ownership check silently matched nothing.
    return Space.create(dataset, { name: 'Test' }).then((space) => {
      expect(space.id).toBeTruthy();
      expect(space.author).toBe('did:test:me');
      expect(space.name).toBe('Test');
    });
  });

  it('starts fields at the values the manifest declares, and leaves the rest unset', async () => {
    const signalType = await SignalType.create(dataset, { name: 'Like' });
    // Declared in the manifest, so it must survive the round trip through a different backend.
    expect(signalType.rangeMax).toBe(1);
    expect(signalType.mode).toBe('toggle');
    expect(signalType.aggregate).toBe('count');

    // A field the manifest gives no default starts unset rather than as an invented `''` — the
    // distinction matters for `avatar`, where "" and "absent" render differently.
    const space = await Space.create(dataset, { name: 'Test' });
    expect(space.avatar).toBeUndefined();
    expect(space.discovery).toBe('hidden');

    const settings = await AgentSettings.create(dataset, {});
    expect(settings.currentTemplateId).toBe('default');
    expect(settings.useSpaceTemplate).toBe(true);
    expect(settings.globalSpaceJoined).toBe(false);
  });
});

describe('reading and writing', () => {
  it('finds by field, and returns null rather than throwing when nothing matches', async () => {
    await Space.create(dataset, { name: 'Alpha', uuid: 'a' });
    await Space.create(dataset, { name: 'Beta', uuid: 'b' });

    const found = await Space.findOne(dataset, { where: { uuid: 'b' } });
    expect(found?.name).toBe('Beta');
    expect(await Space.findOne(dataset, { where: { uuid: 'nope' } })).toBeNull();
  });

  it('persists an edit through save(), without needing the dataset again', async () => {
    const space = await Space.create(dataset, { name: 'Before' });
    (space as Record<string, unknown>).name = 'After';
    await (space as unknown as { save(): Promise<void> }).save();

    const reloaded = await Space.findOne(dataset, { where: { id: space.id as string } });
    expect(reloaded?.name).toBe('After');
  });

  it('deletes', async () => {
    const space = await Space.create(dataset, { name: 'Doomed' });
    await (space as unknown as { delete(): Promise<void> }).delete();
    expect(await Space.findAll(dataset)).toHaveLength(0);
  });

  it('orders and pages, in either dialect of `order`', async () => {
    await Space.create(dataset, { name: 'C' });
    await Space.create(dataset, { name: 'A' });
    await Space.create(dataset, { name: 'B' });

    const ascending = await Space.findAll(dataset, { order: { name: 'asc' } });
    expect(ascending.map((s) => s.name)).toEqual(['A', 'B', 'C']);

    // Stores written against the ORM use ASC/DESC; templates use the lowercase dialect.
    const descending = await Space.findAll(dataset, { order: { name: 'DESC' }, limit: 2 });
    expect(descending.map((s) => s.name)).toEqual(['C', 'B']);
  });

  it('keeps datasets separate', async () => {
    const other = { id: 'ds-2', tables: {} };
    await Space.create(dataset, { name: 'Mine' });

    expect(await Space.findAll(other)).toHaveLength(0);
    expect(await Space.findAll(dataset)).toHaveLength(1);
  });
});

describe('relations', () => {
  it('hydrates a declared relation through include', async () => {
    const template = await Template.create(dataset, { name: 'Docs' });
    const shot = await ImageBlock.create(dataset, { src: 'inmemory://shot.png' });
    await (template as unknown as { addScreenshots(i: unknown): Promise<void> }).addScreenshots(shot);

    const [loaded] = await Template.findAll(dataset, { include: { screenshots: true } });
    const screenshots = loaded.screenshots as { src: string }[];
    expect(screenshots).toHaveLength(1);
    expect(screenshots[0].src).toBe('inmemory://shot.png');
  });

  it('reads a relation back without a query, and removes from it', async () => {
    const settings = await AgentSettings.create(dataset, {});
    const template = await Template.create(dataset, { name: 'Installed' });
    const rel = settings as unknown as {
      addInstalledTemplates(t: unknown): Promise<void>;
      getInstalledTemplates(): Promise<{ name: string }[]>;
      removeInstalledTemplates(t: unknown): Promise<void>;
    };

    await rel.addInstalledTemplates(template);
    expect((await rel.getInstalledTemplates()).map((t) => t.name)).toEqual(['Installed']);

    await rel.removeInstalledTemplates(template);
    expect(await rel.getInstalledTemplates()).toHaveLength(0);
  });

  it('counts a relation as a projection, the way a feed counts signals', async () => {
    const template = await Template.create(dataset, { name: 'Popular' });
    const add = (template as unknown as { addScreenshots(i: unknown): Promise<void> }).addScreenshots;
    await add.call(template, await ImageBlock.create(dataset, { src: 'a' }));
    await add.call(template, await ImageBlock.create(dataset, { src: 'b' }));

    const [row] = await Template.findAll(dataset, {
      include: { $shotCount: { from: 'screenshots', count: true } },
    });
    expect(row.$shotCount).toBe(2);
  });
});

describe('live queries', () => {
  it('pushes the current results, then again on every write to that dataset', async () => {
    const seen = vi.fn();
    const live = Space.query(dataset, { order: { name: 'asc' } });

    const initial = await live.subscribe(seen);
    expect(initial).toHaveLength(0);
    expect(seen).toHaveBeenCalledTimes(1);

    await Space.create(dataset, { name: 'New' });
    expect(seen).toHaveBeenCalledTimes(2);
    expect((seen.mock.lastCall?.[0] as { name: string }[])[0].name).toBe('New');

    live.dispose();
    await Space.create(dataset, { name: 'Later' });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('failing loudly', () => {
  it('names the mistake when handed a ref instead of a handle', async () => {
    // The same confusion that cost this codebase five runtime bugs — a `DatasetRef` where a
    // handle belongs. Opaque handles mean types can't catch it, so the guard has to.
    await expect(Space.findAll({ id: 'ds-1', name: 'x' })).rejects.toThrow(/dataset handle/);
  });

  it('refuses a query shape the neutral IR cannot express, rather than answering a different one', async () => {
    await expect(Space.findAll(dataset, { offset: 5 })).rejects.toThrow(/offset/);
  });
});

describe("'' means empty, on this backend and on AD4M", () => {
  /*
    The contract the two backends disagreed about for a release, in the direction that makes the
    suite lie: `Ad4mModel.setProperty` returned early for `''` — so a clear was a no-op there —
    while this backend wrote it and read it back as empty. Every store test exercising a clear
    passed here and silently did nothing against a real executor, in the one suite whose header
    calls itself a conformance test.

    The AD4M side is repaired (`clearOnEmpty.ts` removes the property's links instead of skipping),
    so both now agree that `''` means empty. These pin *this* half of the agreement: what the
    reference implementation does is the definition, and a change to it has to be a deliberate one.
  */
  it('clears a property written as an empty string', async () => {
    const space = await Space.create(dataset, { name: 'Test', description: 'Something' });

    await Space.update(dataset, space.id, { description: '' });

    const [read] = await Space.findAll(dataset);
    expect(read.description).toBe('');
  });

  it('clears through an instance save as well as through update', async () => {
    // Two write paths, one contract. `save()` is what the block layer's reconcile uses.
    await Space.create(dataset, { name: 'Test', description: 'Something' });

    const [instance] = await Space.findAll(dataset);
    instance.description = '';
    await instance.save();

    const [read] = await Space.findAll(dataset);
    expect(read.description).toBe('');
  });

  it('leaves a field the update did not name alone', async () => {
    // The other half: clearing one property is not clearing the record.
    const space = await Space.create(dataset, { name: 'Test', description: 'Something' });

    await Space.update(dataset, space.id, { description: '' });

    const [read] = await Space.findAll(dataset);
    expect(read.name).toBe('Test');
  });
});

describe('retiring a signal type keeps what people gave', () => {
  /*
    The bug this is here to stop coming back.

    A `Signal` names its type by **record id** (`signalTypeId`), while every template resolves the
    type by slug at render time — `find(local.signalTypes, { slug: 'like' }).id`. Three consequences
    follow, and the middle one is the surprise:

    - Deleting the type removes no signals. They stay, naming an id nothing resolves.
    - Re-creating a type with the same slug does NOT bring them back, because the new record has a
      new id. "Delete it and add it back" therefore loses the history permanently.
    - So a cascade was proposed — sweep up every signal with that id. That destroys other members'
      reactions on one person's click, in a neighbourhood every member can write to, irreversibly,
      and it cannot even be guaranteed: a peer offline during the sweep re-orphans immediately.

    `retired` is the reversible answer, and it is what `deleteShape` already does one layer up:
    the definition stops being offered, the instances keep their data.
  */
  it('leaves every signal in place, and keeps resolving the type behind them', async () => {
    const like = await SignalType.create(dataset, { name: 'Like', slug: 'like' });
    await Signal.create(dataset, { signalTypeId: like.id as string, value: 1 });
    await Signal.create(dataset, { signalTypeId: like.id as string, value: 1 });

    await SignalType.update(dataset, like.id as string, { retired: true });

    // Nothing was removed — which is the entire point.
    expect(await Signal.findAll(dataset)).toHaveLength(2);

    // And the type is still there to be resolved, so a count of what people gave still works.
    // Hiding it from the query instead would read as "nobody ever liked anything".
    const found = await SignalType.findOne(dataset, { where: { slug: 'like' } });
    expect(found?.retired).toBe(true);
  });

  it('comes back whole, because nothing was thrown away', async () => {
    // The scenario a delete cannot serve: withdraw the word, change your mind, and every reaction
    // is exactly where it was. A re-created type would have a new id and none of this history.
    const like = await SignalType.create(dataset, { name: 'Like', slug: 'like' });
    await Signal.create(dataset, { signalTypeId: like.id as string, value: 1 });

    await SignalType.update(dataset, like.id as string, { retired: true });
    await SignalType.update(dataset, like.id as string, { retired: false });

    const restored = await SignalType.findOne(dataset, { where: { slug: 'like' } });
    expect(restored?.retired).toBe(false);
    expect(restored?.id).toBe(like.id);
    expect(await Signal.findAll(dataset, { where: { signalTypeId: like.id as string } })).toHaveLength(1);
  });

  it('starts unretired, so an existing space is unaffected by the field arriving', async () => {
    // `default: false` matters for the pushdown question too: the offered-list filter runs
    // client-side precisely because records predating the field have no value at all here.
    const type = await SignalType.create(dataset, { name: 'Like', slug: 'like' });
    expect(type.retired).toBe(false);
  });
});

describe('an absent property, and what the two backends do with it', () => {
  /*
    Found while adding `SignalType.retired`, and pinned because it decided a design choice.

    A property is a *link* on AD4M, so a record that never had one written has no value at all —
    where this backend holds a row and simply lacks the key. The three cases below are not the same
    across the two, and the middle one is a genuine conformance divergence:

    - `{ field: '' }` does not match an absent value on either. They agree.
    - `{ field: { not: x } }` MATCHES an absent value here, because `undefined !== x` is true in
      JavaScript — and does NOT match on AD4M, because `!=` over an unbound variable excludes the
      row, exactly as SQL's three-valued logic excludes NULL. **A `where` written with `not` is
      therefore green in this suite and silently empty against a real executor**, which is the same
      shape as the `''` contract bug above it.
    - `{ field: { exists: false } }` is the spelling that means "absent" on both.

    This is why `OFFERED_SIGNAL_TYPES` filters client-side instead of pushing
    `{ retired: { not: true } }` down. The `not` form would have passed every test here.

    Not "fixed" by making this backend exclude absent values from `not`: which of the two is right
    is a contract decision (SQL says exclude, JavaScript says match), it would change the meaning of
    every existing `not` query, and the honest first step is that the difference is written down and
    has a test. See the PR's Known follow-ups.
  */
  it('writes a declared default, so a record created normally is filterable on it', async () => {
    // The half that works, and why the exposure is narrow: anything built through `create` carries
    // its manifest defaults whether or not the caller passed them, so the property is not absent.
    await SignalType.create(dataset, { name: 'Live', slug: 'live' });
    const gone = await SignalType.create(dataset, { name: 'Gone', slug: 'gone' });
    await SignalType.update(dataset, gone.id as string, { retired: true });

    const offered = await SignalType.findAll(dataset, { where: { retired: false } });
    expect(offered.map((t) => t.name)).toEqual(['Live']);
  });

  it('does not match an absent property against a value', async () => {
    // `avatar` has no declared default, so it is genuinely absent — the stand-in for a field added
    // to an entity after some records already existed.
    await Space.create(dataset, { name: 'Bare' });
    await Space.create(dataset, { name: 'Pictured', avatar: 'inmemory://pic.png' });

    expect(await Space.findAll(dataset, { where: { avatar: '' } })).toHaveLength(0);
  });

  it('DOES match an absent property against `not` — where AD4M would not', async () => {
    /*
      The divergence, asserted so it is a known quantity rather than a surprise. Do not read this
      as an endorsement: it is what this backend does today, and a `where` relying on it will not
      behave the same way in production.
    */
    await Space.create(dataset, { name: 'Bare' });
    await Space.create(dataset, { name: 'Pictured', avatar: 'inmemory://pic.png' });

    const matched = await Space.findAll(dataset, { where: { avatar: { not: 'inmemory://pic.png' } } });
    expect(matched.map((s) => s.name)).toEqual(['Bare']);
  });

  it('means absent unambiguously with `exists`, on either backend', async () => {
    // The spelling to reach for, and the one the where-grammar documentation now names.
    await Space.create(dataset, { name: 'Bare' });
    await Space.create(dataset, { name: 'Pictured', avatar: 'inmemory://pic.png' });

    const found = await Space.findAll(dataset, {
      where: { OR: [{ avatar: '' }, { avatar: { exists: false } }] },
    });
    expect(found.map((s) => s.name)).toEqual(['Bare']);
  });
});
