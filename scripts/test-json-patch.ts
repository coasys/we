/**
 * Validates that applyPatch produces the expected schemas for each mutation example.
 *
 * Run: npx tsx scripts/test-json-patch.ts
 */

// Inline the core patch logic to avoid zod resolution issues when running standalone.

type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

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
    if (Array.isArray(target)) target = target[parseInt(seg, 10)];
    else if (target != null && typeof target === 'object') target = (target as any)[seg];
    else throw new Error(`Cannot traverse path at segment "${seg}"`);
  }
  const lastSeg = segments[segments.length - 1];
  const key = Array.isArray(target) ? (lastSeg === '-' ? target.length : parseInt(lastSeg, 10)) : lastSeg;
  return { parent: target, key };
}

function getValueAt(doc: unknown, path: string): unknown {
  const segments = parsePath(path);
  let target = doc;
  for (const seg of segments) {
    if (Array.isArray(target)) target = target[parseInt(seg, 10)];
    else if (target != null && typeof target === 'object') target = (target as any)[seg];
    else throw new Error(`Cannot read path "${path}"`);
  }
  return target;
}

function applyOp(doc: unknown, op: PatchOp): void {
  const segments = parsePath(op.path);
  switch (op.op) {
    case 'add': {
      const { parent, key } = getParentAndKey(doc, segments);
      if (Array.isArray(parent)) parent.splice(key as number, 0, op.value);
      else parent[key] = op.value;
      break;
    }
    case 'remove': {
      const { parent, key } = getParentAndKey(doc, segments);
      if (Array.isArray(parent)) parent.splice(key as number, 1);
      else delete parent[key];
      break;
    }
    case 'replace': {
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
      if (JSON.stringify(current) !== JSON.stringify(op.value))
        throw new Error(`Test failed: ${op.path}`);
      break;
    }
  }
}

function applyPatch<T>(doc: T, patches: PatchOp[]): T {
  const clone = structuredClone(doc);
  for (const op of patches) applyOp(clone, op);
  return clone;
}

const baseSchema = {
  meta: { name: 'Base', description: '', icon: '' },
  type: 'Row',
  children: [
    {
      type: 'Column',
      children: [
        {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
          children: ['Home'],
        },
      ],
    },
    { type: 'Column', children: [{ type: '$routes' }] },
  ],
  routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
};

const tests: { name: string; input: object; patches: PatchOp[]; expected: object }[] = [
  {
    name: 'Add button + route',
    input: baseSchema,
    patches: [
      {
        op: 'add',
        path: '/children/0/children/-',
        value: {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
          children: ['Explore'],
        },
      },
      {
        op: 'add',
        path: '/routes/-',
        value: { path: '/explore', type: 'we-text', children: ['Explore page'] },
      },
    ],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
              children: ['Home'],
            },
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
              children: ['Explore'],
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [
        { path: '/', type: 'we-text', children: ['Home page'] },
        { path: '/explore', type: 'we-text', children: ['Explore page'] },
      ],
    },
  },
  {
    name: 'Delete first button',
    input: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
              children: ['Home'],
            },
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
              children: ['Explore'],
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [
        { path: '/', type: 'we-text', children: ['Home page'] },
        { path: '/explore', type: 'we-text', children: ['Explore page'] },
      ],
    },
    patches: [{ op: 'remove', path: '/children/0/children/0' }],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
              children: ['Explore'],
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [
        { path: '/', type: 'we-text', children: ['Home page'] },
        { path: '/explore', type: 'we-text', children: ['Explore page'] },
      ],
    },
  },
  {
    name: 'Rename button text',
    input: baseSchema,
    patches: [
      { op: 'replace', path: '/children/0/children/0/children/0', value: 'Dashboard' },
      { op: 'replace', path: '/routes/0/children/0', value: 'Dashboard page' },
    ],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
              children: ['Dashboard'],
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [{ path: '/', type: 'we-text', children: ['Dashboard page'] }],
    },
  },
  {
    name: 'Add props (style change)',
    input: baseSchema,
    patches: [
      { op: 'add', path: '/children/0/children/0/props/bg', value: '#4fd0ff' },
      { op: 'add', path: '/children/0/children/0/props/r', value: 'pill' },
    ],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/'] }, bg: '#4fd0ff', r: 'pill' },
              children: ['Home'],
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
    },
  },
  {
    name: 'Move sidebar (swap children)',
    input: baseSchema,
    patches: [{ op: 'move', from: '/children/0', path: '/children/1' }],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        { type: 'Column', children: [{ type: '$routes' }] },
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
              children: ['Home'],
            },
          ],
        },
      ],
      routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
    },
  },
  {
    name: 'Add conditional prop',
    input: baseSchema,
    patches: [
      {
        op: 'add',
        path: '/children/0/children/0/props/bg',
        value: {
          $if: {
            condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
            then: 'primary-200',
          },
        },
      },
    ],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: 'we-button',
              props: {
                onClick: { $action: 'routeStore.navigate', args: ['/'] },
                bg: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
                    then: 'primary-200',
                  },
                },
              },
              children: ['Home'],
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
    },
  },
  {
    name: 'Replace node with conditional wrapper',
    input: baseSchema,
    patches: [
      {
        op: 'replace',
        path: '/children/0/children/0',
        value: {
          type: '$if',
          props: {
            condition: { $ne: [{ $store: 'routeStore.currentPath' }, '/'] },
            then: {
              type: 'we-button',
              props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
              children: ['Home'],
            },
          },
        },
      },
    ],
    expected: {
      meta: { name: 'Base', description: '', icon: '' },
      type: 'Row',
      children: [
        {
          type: 'Column',
          children: [
            {
              type: '$if',
              props: {
                condition: { $ne: [{ $store: 'routeStore.currentPath' }, '/'] },
                then: {
                  type: 'we-button',
                  props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
                  children: ['Home'],
                },
              },
            },
          ],
        },
        { type: 'Column', children: [{ type: '$routes' }] },
      ],
      routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
    },
  },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = applyPatch(t.input, t.patches);
  const resultStr = JSON.stringify(result);
  const expectedStr = JSON.stringify(t.expected);

  if (resultStr === expectedStr) {
    console.log(`  PASS  ${t.name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${t.name}`);
    console.log(`    Expected: ${expectedStr.slice(0, 120)}...`);
    console.log(`    Got:      ${resultStr.slice(0, 120)}...`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
