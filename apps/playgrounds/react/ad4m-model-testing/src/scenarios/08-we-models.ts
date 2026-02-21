// Phase 2 migration smoke test — exercises @we/models Space and Block
// with the new decorator API (@Model, @Field, @HasMany).
import type { PerspectiveProxy } from '@coasys/ad4m';
import type { ScenarioModule, TestResult } from '../harness/types';
import { Space } from '@we/models';
import { Block } from '@we/models';

async function test(name: string, fn: () => Promise<void> | void): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name, passed: false, error: e?.message ?? String(e), durationMs: Date.now() - start };
  }
}

export const scenario: ScenarioModule = {
  name: '08 — @we/models (Space + Block)',
  run: async (perspective: PerspectiveProxy) => {
    const results: TestResult[] = [];

    // ── Space tests ────────────────────────────────────────────────────────
    const spaceBase = await test('Space.save() writes expected links', async () => {
      const space = new Space(perspective);
      space.uuid = 'test-uuid-1';
      space.name = 'Test Space';
      space.description = 'A test space';
      await space.save();
    });
    results.push(spaceBase);

    results.push(await test('Space.findAll() returns saved Space instances', async () => {
      const spaces = await Space.findAll(perspective);
      if (!spaces.length) throw new Error('No spaces found');
    }));

    results.push(await test('Space fields round-trip correctly', async () => {
      const space = new Space(perspective);
      space.uuid = 'roundtrip-uuid';
      space.name = 'Round Trip';
      space.description = 'desc';
      space.visibility = 'public';
      await space.save();
      const found = await Space.findAll(perspective, { where: { uuid: 'roundtrip-uuid' } });
      if (!found.length) throw new Error('Space not found by uuid');
      if (found[0].name !== 'Round Trip') throw new Error(`name mismatch: ${found[0].name}`);
    }));

    results.push(await test('Space.locations @HasMany collection works', async () => {
      const space = new Space(perspective);
      space.uuid = 'location-test';
      space.name = 'Location Space';
      space.description = 'desc';
      await space.save();
      await (space as any).addLocations('test://location/1');
      const updated = await Space.findAll(perspective, { where: { uuid: 'location-test' } });
      if (!updated[0]?.locations?.includes('test://location/1')) throw new Error('location not added');
    }));

    // ── Block tests ────────────────────────────────────────────────────────
    results.push(await test('Block.save() writes expected links', async () => {
      const block = new Block(perspective);
      block.type = 'we://text_block';
      await block.save();
    }));

    results.push(await test('Block.findAll() returns saved Block instances', async () => {
      const blocks = await Block.findAll(perspective);
      if (!blocks.length) throw new Error('No blocks found');
    }));

    results.push(await test('Block.type @Field round-trips correctly', async () => {
      const block = new Block(perspective);
      block.type = 'we://image_block';
      await block.save();
      const found = await Block.findAll(perspective, { where: { type: 'we://image_block' } });
      if (!found.length) throw new Error('Block not found by type');
    }));

    results.push(await test('Block.comments @HasMany collection works', async () => {
      const block = new Block(perspective);
      block.type = 'we://text_block';
      await block.save();
      await (block as any).addComments('test://comment/1');
      const updated = await Block.findAll(perspective, {
        where: { baseExpression: block.baseExpression }
      });
      if (!updated[0]?.comments?.includes('test://comment/1')) throw new Error('comment not added');
    }));

    results.push(await test('Block.reactions @HasMany collection works', async () => {
      const block = new Block(perspective);
      block.type = 'we://text_block';
      await block.save();
      await (block as any).addReactions('test://reaction/thumbsup');
      const updated = await Block.findAll(perspective, {
        where: { baseExpression: block.baseExpression }
      });
      if (!updated[0]?.reactions?.includes('test://reaction/thumbsup')) throw new Error('reaction not added');
    }));

    return results;
  },
};

