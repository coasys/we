import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureNodeIds } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const STORE = join(__dirname, '../src/frameworks/solid/stores/TemplateStore.tsx');
const EDITOR_STORE = join(__dirname, '../src/frameworks/solid/stores/EditorStore.tsx');

/**
 * `node.id` is the visual editor's only handle on the tree.
 *
 * The renderer stamps `data-we-node-id` from it, and selection, the inspector, the theme-role
 * readout and every ancestry walk go through `findNodeById`. A tree that never passed through
 * `ensureNodeIds` renders *identically* and cannot be clicked at all — so the failure does not look
 * like a missing id, it looks like the visual editor being broken, and it is invisible to anything
 * that only checks what is on screen.
 *
 * Three of six setters had forgotten. The one that mattered was `saveTemplateAs`, which is how both
 * "Start fresh" and "Fork" arrive: `starterTemplate` is hand-written with no ids, so a brand-new
 * template was inert to the first click anybody gave it.
 *
 * This is a source-level assertion because the defect is a *missing call*, and no test of behaviour
 * catches one — a store with a template nobody can select still returns the right template.
 */
describe('every schema that becomes the live template gets node ids', () => {
  const source = readFileSync(STORE, 'utf8');

  it('setCurrentTemplate is called from exactly one place', () => {
    const calls = source.match(/setCurrentTemplate\(/g) ?? [];
    // The destructured signal declaration, plus the single call inside commitTemplate.
    expect(calls.length, 'a new setCurrentTemplate call bypasses ensureNodeIds — route it through commitTemplate').toBe(
      1,
    );
  });

  it('that one place ensures ids before it sets', () => {
    const body = /function commitTemplate\([\s\S]*?\n  \}/.exec(source)?.[0] ?? '';
    expect(body, 'commitTemplate not found').toContain('ensureNodeIds');
    expect(body.indexOf('ensureNodeIds')).toBeLessThan(body.indexOf('setCurrentTemplate'));
  });

  it('the boot template is ensured too, being the one tree no setter ever touches', () => {
    expect(source).toMatch(/const initialTemplate = [\s\S]*?ensureNodeIds\(/);
  });
});

/**
 * The starter template ships with no ids of its own — which is fine, and is exactly why the commit
 * path has to add them. Asserted so that "fresh templates are inert" cannot come back by someone
 * deciding `starterTemplate` looked complete without them.
 */
describe('the starter template', () => {
  it('carries no ids in source, and gets a full set from ensureNodeIds', () => {
    const source = readFileSync(EDITOR_STORE, 'utf8');
    const starter = /const starterTemplate: SchemaNode = \{[\s\S]*?\n\};/.exec(source)?.[0] ?? '';
    expect(starter, 'starterTemplate not found').toBeTruthy();
    expect(starter).not.toMatch(/\bid:\s*'/);

    // The shape it is given at commit time: every node addressable.
    const tree = {
      type: 'Column',
      children: [
        { type: 'we-text', children: ['x'] },
        { type: 'Row', children: [] },
      ],
    };
    ensureNodeIds(tree);
    const ids: string[] = [];
    const walk = (n: { id?: string; children?: unknown[] }) => {
      ids.push(n.id!);
      for (const c of n.children ?? []) if (c && typeof c === 'object') walk(c as { id?: string });
    };
    walk(tree);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
