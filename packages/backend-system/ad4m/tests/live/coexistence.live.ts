/**
 * WE's classes beside another app's classes of the same name, against a real executor.
 *
 * A space that began as a Flux community holds Flux's `Topic` (`flux://Topic`). WE has a `Topic` of
 * its own (`we://Topic`). The executor addresses a class by its target class IRI, so both classes can
 * be registered in one perspective, and each app reads only its own instances.
 *
 * The unit tests check what WE sends. Only the executor can show that the two classes do not read
 * each other's instances, so this case asks it:
 *
 * 1. Register a Flux-like `flux://Topic` and create a Flux topic.
 * 2. Run WE's space initialization.
 * 3. WE creates the topic "Design".
 * 4. WE's topic list holds only "Design".
 * 5. The Flux topic is still read by `flux://Topic`.
 */
import { Ad4mClient, Ad4mModel, type PerspectiveProxy } from '@coasys/ad4m';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { Topic } from '../../src/entities';
import { buildEntityFromEntry, getForeignShacl, installSpaceSdna, isEntityRegistered } from '../../src/index';

type ModelClass = typeof Ad4mModel & {
  create(p: PerspectiveProxy, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  findAll(p: PerspectiveProxy, query?: unknown): Promise<Record<string, unknown>[]>;
  getTargetClass(): string;
};

/** A class shaped like Flux's topic: named `Topic`, in Flux's namespace. */
const FluxTopic = buildEntityFromEntry(
  {
    name: 'Topic',
    targetClass: 'flux://Topic',
    properties: [
      { name: 'title', predicate: 'flux://title', type: 'string', isCollection: false, required: true, writable: true },
    ],
  },
  { flag: { through: 'flux://entry_type', value: 'flux://has_topic' } },
) as ModelClass;

const WeTopic = Topic as unknown as ModelClass;

let opened: { client: Ad4mClient; perspective: PerspectiveProxy } | undefined;

afterAll(async () => {
  if (!opened) return;
  await opened.client.perspective.remove(opened.perspective.uuid).catch(() => undefined);
  opened.client.close();
});

describe("WE's Topic beside Flux's Topic", () => {
  it('registers both classes, and each app reads only its own topics', { timeout: 180_000 }, async () => {
    const { url, token } = inject('ad4mExecutor');
    const client = new Ad4mClient(url, token);
    const perspective = await client.perspective.add(`we-coexistence-${Date.now()}`);
    opened = { client, perspective };

    // The two classes have one name and two target classes.
    expect(FluxTopic.getTargetClass()).toBe('flux://Topic');
    expect(WeTopic.getTargetClass()).not.toBe('flux://Topic');

    // 1. The space as Flux left it.
    await Ad4mModel.registerAll(perspective, [FluxTopic]);
    await FluxTopic.create(perspective, { title: 'From Flux' });

    // 2. WE initializes the space. Same-name classes are not refused.
    await installSpaceSdna(perspective);
    expect(await isEntityRegistered(perspective, Topic as never)).toBe(true);
    const topics = (await perspective.shapes(['Topic'])).map((s) => s.shape.targetClass).sort();
    expect(topics).toEqual([WeTopic.getTargetClass(), 'flux://Topic'].sort());

    // 3. WE creates a topic.
    await WeTopic.create(perspective, { name: 'Design' });

    // 4. WE's list holds only WE's topic.
    const ours = await WeTopic.findAll(perspective);
    expect(ours.map((t) => t.name)).toEqual(['Design']);

    // 5. Flux's class still reads Flux's topic, and only it.
    const theirs = await FluxTopic.findAll(perspective);
    expect(theirs.map((t) => t.title)).toEqual(['From Flux']);

    // WE sees Flux's class as foreign, named by its IRI because WE has a `Topic` of its own.
    const foreign = await getForeignShacl(perspective);
    expect(foreign.map((s) => s.name)).toContain('flux://Topic');
    expect(foreign.map((s) => s.name)).not.toContain('Topic');
  });
});
