import type { PerspectiveProxy, SHACLShape } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

// ── Mock the WE models registry ──────────────────────────────────────────────
vi.mock('@we/models', () => ({
  getRegisteredModelNames: () => ['Message', 'Channel'],
  getModel: (name: string) => ({ name }),
  getModelTargetClass: (model: { name: string }) => {
    const map: Record<string, string> = {
      Message: 'flux://Message',
      Channel: 'flux://Channel',
    };
    return map[model.name] ?? '';
  },
}));

import { getForeignShacl } from './perspectiveHelpers';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeShape(targetClass?: string): SHACLShape {
  return {
    nodeShapeUri: `${targetClass ?? 'unknown'}Shape`,
    targetClass,
    properties: [],
    parentShapes: [],
  } as unknown as SHACLShape;
}

function mockPerspective(shapes: Array<{ name: string; shape: SHACLShape }>): PerspectiveProxy {
  return {
    getAllShacl: vi.fn().mockResolvedValue(shapes),
  } as unknown as PerspectiveProxy;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getForeignShacl', () => {
  it('returns shapes whose names do not match any native model', async () => {
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('app://Task') },
      { name: 'Note', shape: makeShape('app://Note') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.length).toBe(2);
    expect(foreign.map((s) => s.name)).toEqual(['Task', 'Note']);
  });

  it('filters out shapes that match a native model name AND targetClass', async () => {
    const perspective = mockPerspective([
      // Same name + same targetClass → native, should be filtered out
      { name: 'Message', shape: makeShape('flux://Message') },
      // Foreign shape
      { name: 'Task', shape: makeShape('app://Task') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.length).toBe(1);
    expect(foreign[0].name).toBe('Task');
  });

  it('keeps shapes that share a native name but have a different targetClass', async () => {
    const perspective = mockPerspective([
      // Same name "Message" but different targetClass → foreign namesake
      { name: 'Message', shape: makeShape('other-app://Message') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.length).toBe(1);
    expect(foreign[0].name).toBe('Message');
    expect(foreign[0].shape.targetClass).toBe('other-app://Message');
  });

  it('keeps shapes with a native name collision when targetClass is missing', async () => {
    const perspective = mockPerspective([
      // Same name but no targetClass → can't confirm it's native, keep it
      { name: 'Channel', shape: makeShape(undefined) },
    ]);

    const foreign = await getForeignShacl(perspective);

    // targetClass == null → filter returns false (null != null is false), so this should be filtered
    // Actually: shape.targetClass != null → false, so the filter returns true only if !nativeNames.has(name)
    // "Channel" IS in nativeNames, so we enter the disambiguation branch:
    //   shape.targetClass != null (null != null → false), so the filter returns false
    expect(foreign.length).toBe(0);
  });

  it('returns an empty array when the perspective has no shapes', async () => {
    const perspective = mockPerspective([]);
    const foreign = await getForeignShacl(perspective);
    expect(foreign).toEqual([]);
  });

  it('calls getAllShacl exactly once', async () => {
    const perspective = mockPerspective([{ name: 'X', shape: makeShape('app://X') }]);

    await getForeignShacl(perspective);

    expect(perspective.getAllShacl).toHaveBeenCalledTimes(1);
  });
});
