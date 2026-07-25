import { z } from 'zod';

export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

export const zPatchOp: z.ZodType<PatchOp> = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string() }).strict(),
  z.object({ op: z.literal('replace'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('move'), from: z.string(), path: z.string() }).strict(),
  z.object({ op: z.literal('copy'), from: z.string(), path: z.string() }).strict(),
  z.object({ op: z.literal('test'), path: z.string(), value: z.unknown() }).strict(),
]);

export const zPatchResponse = z.object({
  response: z.string(),
  patches: z.array(zPatchOp),
});

export type PatchResponse = z.infer<typeof zPatchResponse>;

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePath(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error(`Invalid JSON Pointer: "${path}"`);
  return path.slice(1).split('/').map(unescapePointer);
}

function getParentAndKey(doc: unknown, segments: string[]): { parent: any; key: string | number } {
  let target = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (Array.isArray(target)) {
      target = target[parseInt(seg, 10)];
    } else if (target != null && typeof target === 'object') {
      target = (target as Record<string, unknown>)[seg];
    } else {
      throw new Error(`Cannot traverse path at segment "${seg}"`);
    }
  }
  const lastSeg = segments[segments.length - 1];
  const key = Array.isArray(target) ? (lastSeg === '-' ? target.length : parseInt(lastSeg, 10)) : lastSeg;
  return { parent: target, key };
}

function getValueAt(doc: unknown, path: string): unknown {
  const segments = parsePath(path);
  let target = doc;
  for (const seg of segments) {
    if (Array.isArray(target)) {
      target = target[parseInt(seg, 10)];
    } else if (target != null && typeof target === 'object') {
      target = (target as Record<string, unknown>)[seg];
    } else {
      throw new Error(`Cannot read path "${path}"`);
    }
  }
  return target;
}

function applyOp(doc: unknown, op: PatchOp): void {
  const segments = parsePath(op.path);

  switch (op.op) {
    case 'add': {
      if (segments.length === 0) throw new Error('Cannot add to root');
      const { parent, key } = getParentAndKey(doc, segments);
      if (Array.isArray(parent)) {
        parent.splice(key as number, 0, op.value);
      } else {
        parent[key] = op.value;
      }
      break;
    }

    case 'remove': {
      if (segments.length === 0) throw new Error('Cannot remove root');
      const { parent, key } = getParentAndKey(doc, segments);
      if (Array.isArray(parent)) {
        parent.splice(key as number, 1);
      } else {
        delete parent[key];
      }
      break;
    }

    case 'replace': {
      if (segments.length === 0) throw new Error('Cannot replace root');
      const { parent, key } = getParentAndKey(doc, segments);
      parent[key] = op.value;
      break;
    }

    case 'move': {
      const value = getValueAt(doc, op.from);
      applyOp(doc, { op: 'remove', path: op.from });
      applyOp(doc, { op: 'add', path: op.path, value });
      break;
    }

    case 'copy': {
      const value = structuredClone(getValueAt(doc, op.from));
      applyOp(doc, { op: 'add', path: op.path, value });
      break;
    }

    case 'test': {
      const current = getValueAt(doc, op.path);
      if (JSON.stringify(current) !== JSON.stringify(op.value)) {
        throw new Error(`Test failed: ${op.path} expected ${JSON.stringify(op.value)}, got ${JSON.stringify(current)}`);
      }
      break;
    }
  }
}

export function applyPatch<T>(doc: T, patches: PatchOp[]): T {
  const clone = structuredClone(doc);
  for (const op of patches) {
    applyOp(clone, op);
  }
  return clone;
}

export function validatePatches(patches: unknown): { valid: boolean; errors: string[] } {
  const result = z.array(zPatchOp).safeParse(patches);
  if (result.success) return { valid: true, errors: [] };
  return { valid: false, errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
