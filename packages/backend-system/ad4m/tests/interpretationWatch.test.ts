/**
 * Registering a standing watch, and not registering it again.
 *
 * `write_processor` overwrites a processor's scalars but ADDS its class links, one copy per class
 * per registration, under whoever registered. So once a second member (or the same client twice)
 * has registered, the config holds every class twice. The adapter read those copies as a list and
 * compared it with the wanted set, found `[A, A, B, B]` unequal to `[A, B]`, deleted the whole config
 * and registered again — which added more copies. Every `watch` did that, and two `watch` calls for
 * one id ran at once, each removing the same links (the second failing "Link not found"). On staging
 * that was ~940 link removals and ~46 re-registrations in seven minutes from one client, each churning
 * every live query in the space.
 *
 * Pinned here: copies from several authors read as one set; a config that already says what the
 * watch wants is left alone; a different one is still replaced; a changed setting is rewritten in
 * place rather than by deleting; two concurrent calls for one watch make one registration; and a
 * config the current engine cannot load — one stored before the source scope became a class and a
 * property — is deleted and re-registered rather than read as present.
 */
import { createAd4mInterpretationPort, registerEntity, unregisterEntity } from '@we/backend-ad4m';
import { getEntity, getEntityTargetClass } from '@we/entities';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventBlock, Relationship, TaskBlock, TextBlock } from '../src/entities';

const MODELS = { TaskBlock, EventBlock, Relationship, TextBlock };
beforeAll(() => {
  for (const [name, model] of Object.entries(MODELS)) registerEntity(name, model as never);
});
afterAll(() => {
  for (const name of Object.keys(MODELS)) unregisterEntity(name);
});

const WATCH = 'we-call-root';
const NODE = `ad4m://autoprocessor/${WATCH}`;
const CLASS = 'ad4m://interpretation_class';

/** The scalar paths `write_processor` writes through its setters, keyed by the field it takes. */
const SCALARS: Record<string, string> = {
  sourceClass: 'ad4m://source_class',
  sourceText: 'ad4m://source_text',
  sourceQuery: 'ad4m://source_query',
  basePrefix: 'ad4m://base_prefix',
  debounceMs: 'ad4m://debounce_ms',
  batchMin: 'ad4m://batch_min',
  batchMax: 'ad4m://batch_max',
  maxWaitMs: 'ad4m://max_wait_ms',
  claimTtlMs: 'ad4m://claim_ttl_ms',
  emitDebugEvents: 'ad4m://emit_debug_events',
};

/** The predicate a config from before the model scope carried its gather as — the loader no longer reads it. */
const LEGACY_SCOPE_PREDICATE = 'ad4m://source_scope_query';

const literal = (value: unknown) => `literal:string:${encodeURIComponent(String(value))}`;
const targetOf = (name: string) => getEntityTargetClass(getEntity(name) as never) as string;

type FakeLink = { author: string; data: { source: string; predicate: string; target: string } };

/**
 * A perspective that stores links the way the executor does for a processor: scalars replaced on
 * every registration, class links added. `remove` refuses a link that is not there, as the
 * executor's `removeLink` does. `removeAutoProcessor` deletes every link sourced at the processor
 * node in one call and answers whether there was anything, as `remove_processor` does — and leaves
 * the processor's `InterpretationRun` nodes, which point AT the node rather than from it.
 */
function perspective(agent = 'did:me', foreign: Record<string, string> = {}) {
  let links: FakeLink[] = [];
  const calls = { get: 0, add: 0, remove: 0, failedRemove: 0, removeProcessor: 0 };
  const order: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const register = (author: string, config: Record<string, unknown>) => {
    for (const [field, predicate] of Object.entries(SCALARS)) {
      if (config[field] === undefined) continue;
      links = links.filter((l) => !(l.data.source === NODE && l.data.predicate === predicate));
      links.push({ author, data: { source: NODE, predicate, target: literal(config[field]) } });
    }
    for (const cls of config.interpretationClasses as string[]) {
      links.push({ author, data: { source: NODE, predicate: CLASS, target: `literal:string:${cls}` } });
    }
  };
  const handle = {
    uuid: 'p1',
    on: (event: string, cb: (e: unknown) => void) => {
      listeners.set(event, cb);
      return () => listeners.delete(event);
    },
    // The registry as the executor answers it: by name or by target class. WE's own classes come
    // from their models; `foreign` holds the classes another app registered.
    shapes: async (keys?: string[]) =>
      [
        ...Object.keys(MODELS).map((name) => ({ name, shape: { targetClass: targetOf(name) }, hash: '' })),
        ...Object.entries(foreign).map(([name, targetClass]) => ({ name, shape: { targetClass }, hash: '' })),
      ].filter(({ name, shape }) => !keys || keys.includes(name) || keys.includes(shape.targetClass)),
    get: async (query: { source?: string; predicate?: string }) => {
      calls.get += 1;
      // A real read yields the event loop; so does this one, so concurrent callers interleave.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return links.filter(
        (l) =>
          (!query.source || l.data.source === query.source) &&
          (!query.predicate || l.data.predicate === query.predicate),
      );
    },
    remove: async (link: FakeLink) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const at = links.indexOf(link);
      if (at < 0) {
        calls.failedRemove += 1;
        throw new Error('Link not found');
      }
      calls.remove += 1;
      links.splice(at, 1);
    },
    removeAutoProcessor: async (processorId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      calls.removeProcessor += 1;
      order.push('removeAutoProcessor');
      const node = `ad4m://autoprocessor/${processorId}`;
      const had = links.some((l) => l.data.source === node);
      links = links.filter((l) => l.data.source !== node);
      return had;
    },
    addAutoProcessor: async (config: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      calls.add += 1;
      order.push('addAutoProcessor');
      register(agent, config);
      return config.processorId;
    },
    add: async (link: { data: FakeLink['data'] } | FakeLink['data']) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      links.push({ author: agent, data: 'data' in link ? link.data : link });
    },
    setSingleTarget: async (link: FakeLink['data']) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      links = links.filter((l) => !(l.data.source === link.source && l.data.predicate === link.predicate));
      links.push({ author: agent, data: { source: link.source, predicate: link.predicate, target: link.target } });
    },
    getSingleTarget: async (query: { source: string; predicate: string }) =>
      links.find((l) => l.data.source === query.source && l.data.predicate === query.predicate)?.data.target,
  };
  return {
    handle: handle as never,
    calls,
    /** Emit an executor event the way the real stream does — the listener's work is async. */
    emit: async (event: Record<string, unknown>) => {
      listeners.get('auto-processor-event')?.(event);
      // The listener parents in a promise chain of perspective calls; let it run.
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    /** The processor calls in the order they were made. */
    order,
    /** A run the processor wrote: a node pointing at the config, which removal must not touch. */
    addRun: (run: string) =>
      links.push({ author: agent, data: { source: run, predicate: 'ad4m://interp/processor', target: NODE } }),
    linksFrom: (source: string) => links.filter((l) => l.data.source === source).length,
    linksTo: (target: string) => links.filter((l) => l.data.target === target).length,
    /** Another member registering, as their own client would. */
    registerAs: register,
    /** A raw link on the config node, for shapes no current field writes — a stale registration's. */
    putLink: (predicate: string, target: string, author = agent) =>
      links.push({ author, data: { source: NODE, predicate, target } }),
    /** Whether the config node carries a link under a raw predicate — for one no field writes. */
    hasLink: (predicate: string) => links.some((l) => l.data.source === NODE && l.data.predicate === predicate),
    classes: () => links.filter((l) => l.data.predicate === CLASS).map((l) => l.data.target),
    scalar: (field: string) => links.find((l) => l.data.predicate === SCALARS[field])?.data.target,
    /** A stored scalar as the value it holds — what `sameRegistration` compares against. */
    value: (field: string) => {
      const stored = links.find((l) => l.data.predicate === SCALARS[field])?.data.target;
      return stored ? decodeURIComponent(stored.slice('literal:string:'.length)) : undefined;
    },
  };
}

const request = (classes: string[], extra: Record<string, unknown> = {}) => ({
  watchId: WATCH,
  classes,
  parent: { id: 'we://collection/root', relation: 'children', entity: 'CollectionBlock' },
  provenance: { id: 'we://collection/root', relation: 'extracted', entity: 'CollectionBlock' },
  ...extra,
});

/** What one registration looks like once it has landed, read back off a fake. */
async function registeredOnce(p: ReturnType<typeof perspective>) {
  const port = createAd4mInterpretationPort(() => 'did:me');
  await port.watch!(p.handle, request(['TaskBlock', 'EventBlock', 'Relationship']) as never);
  return port;
}

describe('a standing watch', () => {
  it('reads the same classes from several members as one set, and leaves it alone', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    // A second member registers the same watch: every class link now exists twice.
    const scalars = Object.fromEntries(
      Object.keys(SCALARS).map((f) => [f, decodeURIComponent(p.scalar(f)!.slice(15))]),
    );
    p.registerAs('did:peer', {
      ...scalars,
      interpretationClasses: ['TaskBlock', 'EventBlock', 'Relationship'].map(targetOf),
    });
    expect(p.classes()).toHaveLength(6);
    const before = { ...p.calls };

    await port.watch!(p.handle, request(['TaskBlock', 'EventBlock', 'Relationship']) as never);

    expect(p.calls.remove - before.remove).toBe(0);
    expect(p.calls.add - before.add).toBe(0);
    expect(p.classes()).toHaveLength(6);
  });

  it('registers the source as the text-block class, its text property, and the parent scope', async () => {
    const p = perspective();
    await registeredOnce(p);

    // The class by its target-class IRI — two apps' classes can share the name "TextBlock".
    expect(p.value('sourceClass')).toBe(targetOf('TextBlock'));
    expect(p.value('sourceText')).toBe('text');
    // The conversation's own children (`parent` in the request resolves `children` to `has_child`)
    // and their thread replies, only the lines a person wrote.
    expect(p.value('sourceQuery')).toBe(
      JSON.stringify({
        parent: { ids: 'we://collection/root', path: ['ad4m://has_child', 'we://thread'] },
        where: { source: ['spoken', 'typed', 'corrected'] },
      }),
    );
  });

  it('reads a stored config without a source class as outdated, and replaces it whole', async () => {
    const p = perspective();
    // The shape a pre-model-scope registration left on the node: the same classes and settings,
    // the gather as SPARQL, and none of the fields the loader now requires.
    p.registerAs('did:peer', {
      basePrefix: 'we://interpreted/we%3A%2F%2Fcollection%2Froot/',
      debounceMs: 15_000,
      batchMin: 3,
      batchMax: 100,
      maxWaitMs: 120_000,
      claimTtlMs: 600_000,
      emitDebugEvents: true,
      interpretationClasses: ['TaskBlock', 'EventBlock', 'Relationship'].map(targetOf),
    });
    p.putLink(LEGACY_SCOPE_PREDICATE, literal('SELECT ?speaker ?text ?timestamp WHERE { ?m <we://text> ?text }'));
    const before = { ...p.calls };

    await createAd4mInterpretationPort(() => 'did:me').watch!(
      p.handle,
      request(['TaskBlock', 'EventBlock', 'Relationship']) as never,
    );

    // The whole node goes — rewriting over it would leave `ad4m://source_scope_query` behind.
    expect(p.calls.removeProcessor - before.removeProcessor).toBe(1);
    expect(p.calls.add - before.add).toBe(1);
    expect(p.order.slice(-2)).toEqual(['removeAutoProcessor', 'addAutoProcessor']);
    expect(p.hasLink(LEGACY_SCOPE_PREDICATE)).toBe(false);
    expect(p.value('sourceClass')).toBe(targetOf('TextBlock'));
    expect(p.value('sourceQuery')).toBe(
      JSON.stringify({
        parent: { ids: 'we://collection/root', path: ['ad4m://has_child', 'we://thread'] },
        where: { source: ['spoken', 'typed', 'corrected'] },
      }),
    );
  });

  it('does nothing but read when the config already says what the watch wants', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    const before = { ...p.calls };

    await port.watch!(p.handle, request(['Relationship', 'TaskBlock', 'EventBlock']) as never);

    expect(p.calls.remove - before.remove).toBe(0);
    expect(p.calls.add - before.add).toBe(0);
    expect(p.calls.get - before.get).toBe(1);
  });

  it('still replaces the config when the classes differ', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    const before = { ...p.calls };

    await port.watch!(p.handle, request(['TaskBlock']) as never);

    // One batched removal, then the registration — never a link at a time.
    expect(p.calls.remove - before.remove).toBe(0);
    expect(p.calls.removeProcessor - before.removeProcessor).toBe(1);
    expect(p.calls.add - before.add).toBe(1);
    expect(p.order.slice(-2)).toEqual(['removeAutoProcessor', 'addAutoProcessor']);
    expect(p.classes()).toEqual([`literal:string:${targetOf('TaskBlock')}`]);
  });

  it('rewrites a changed setting in place, without deleting the config', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    const before = { ...p.calls };

    await port.watch!(p.handle, request(['TaskBlock', 'EventBlock', 'Relationship'], { batchMax: 40 }) as never);

    expect(p.calls.remove - before.remove).toBe(0);
    expect(p.calls.add - before.add).toBe(1);
    expect(p.scalar('batchMax')).toBe(literal(40));
  });

  it('runs two concurrent calls for one watch one after the other, registering once', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    const before = { ...p.calls };

    await Promise.all([
      port.watch!(p.handle, request(['TaskBlock']) as never),
      port.watch!(p.handle, request(['TaskBlock']) as never),
    ]);

    expect(p.calls.failedRemove).toBe(0);
    expect(p.calls.add - before.add).toBe(1);
    expect(p.classes()).toEqual([`literal:string:${targetOf('TaskBlock')}`]);
  });
});

describe('stopping a standing watch', () => {
  it('removes the whole config in one call, not a link at a time, and keeps the runs', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    p.addRun('ad4m://interp/run-1');
    expect(p.linksFrom(NODE)).toBeGreaterThan(1);
    const before = { ...p.calls };

    await port.unwatch!(p.handle, WATCH);

    expect(p.calls.removeProcessor - before.removeProcessor).toBe(1);
    expect(p.calls.remove - before.remove).toBe(0);
    expect(p.calls.get - before.get).toBe(0);
    expect(p.linksFrom(NODE)).toBe(0);
    // The run is the processed-turn cursor: a watch registered again under this id resumes from it.
    expect(p.linksTo(NODE)).toBe(1);
  });

  it('is quiet when there is no processor to stop', async () => {
    const p = perspective();
    const port = createAd4mInterpretationPort(() => 'did:me');

    await expect(port.unwatch!(p.handle, WATCH)).resolves.toBeUndefined();
    await expect(port.unwatch!(p.handle, 'never-registered')).resolves.toBeUndefined();

    expect(p.calls.removeProcessor).toBe(2);
    expect(p.calls.remove).toBe(0);
  });
});

describe('a pass that outlives its watch', () => {
  const BASE = `we://interpreted/${encodeURIComponent('we://collection/root')}/a-record`;

  it('still files what it minted when `processed` lands after `unwatch`', async () => {
    /*
      The last pass of a call very often settles after everybody has hung up. If `unwatch` drops
      where the pass files, the `processed` event that lands next is dropped with it: a minted
      record that no surface can reach by traversal.
    */
    const p = perspective();
    const port = await registeredOnce(p);
    await port.unwatch!(p.handle, WATCH);

    await p.emit({ step: 'processed', processorId: WATCH, agentDid: 'did:me', bases: [BASE] });

    // Containment under the watch's parent, and provenance back to the conversation.
    expect(p.linksTo(BASE)).toBe(2);
  });

  it('still files when `processed` lands on a new session, after a reload', async () => {
    const p = perspective();
    await registeredOnce(p);

    // A new port, as a reloaded page builds: its map is empty, the graph keeps the filing.
    const reloaded = createAd4mInterpretationPort(() => 'did:me');
    await reloaded.observe!(p.handle, () => {});
    await p.emit({ step: 'processed', processorId: WATCH, agentDid: 'did:me', bases: [BASE] });

    expect(p.linksTo(BASE)).toBe(2);
  });

  it('does not file another agent’s pass, whatever the graph says', async () => {
    const p = perspective();
    const port = await registeredOnce(p);
    await port.unwatch!(p.handle, WATCH);

    await p.emit({ step: 'processed', processorId: WATCH, agentDid: 'did:peer', bases: [BASE] });

    expect(p.linksTo(BASE)).toBe(0);
  });
});

describe('a class the space already had', () => {
  it('watches it by the target class its SHACL names, with no WE model behind it', async () => {
    const p = perspective('did:me', { DiscussionTopic: 'conv://DiscussionTopic' });
    await createAd4mInterpretationPort(() => 'did:me').watch!(
      p.handle,
      request(['TaskBlock', 'DiscussionTopic']) as never,
    );
    expect(p.classes()).toEqual([`literal:string:${targetOf('TaskBlock')}`, 'literal:string:conv://DiscussionTopic']);
  });

  it('still refuses a name with neither a model nor a target class', async () => {
    const p = perspective('did:me', { Broken: '' });
    await expect(
      createAd4mInterpretationPort(() => 'did:me').watch!(p.handle, request(['Broken']) as never),
    ).rejects.toThrow('no schema named "Broken"');
  });
});
