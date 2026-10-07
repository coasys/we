import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deriveNodeIds, ensureNodeIds, forEachNode, isNodeId, type SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { bundledTemplates } from '../src/shared/registries/bundledTemplates.generated';
import { templateRegistry } from '../src/shared/registries/templateRegistry';
import { viewRegistry } from '../src/shared/registries/viewRegistry';

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

/**
 * A built-in is code run at load, so its ids are worked out rather than kept — and they have to come
 * out the same every time, or every node of every built-in is somebody new after a restart. Checked
 * over the real registries, since the property that matters is about the templates this build ships.
 */
describe('the templates this build ships', () => {
  const idsOf = (node: SchemaNode): string[] => {
    const out: string[] = [];
    forEachNode(node, (n) => n.id && out.push(n.id));
    return out;
  };
  const registries = { ...templateRegistry, ...viewRegistry };

  it.each(Object.keys(registries))('%s: every node below the root has an id, and no two share one', (id) => {
    const template = registries[id] as SchemaNode;
    const ids = idsOf(template);
    let without = 0;
    forEachNode(template, (n) => n !== template && !n.id && without++);
    expect(without).toBe(0);
    expect(ids.every(isNodeId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(Object.entries(bundledTemplates))('%s: has the same ids however many times it is derived', (id, source) => {
    const again = deriveNodeIds(JSON.parse(JSON.stringify(source)) as SchemaNode, id);
    expect(idsOf(again)).toEqual(idsOf(templateRegistry[id] as SchemaNode));
  });
});
