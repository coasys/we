/**
 * Editing a template through tools, the way a host that holds the conversation does.
 *
 * The rules are the session's and are pinned there; what is pinned here is the contract a host
 * relies on: errors come back as text the model can act on rather than as throws, arguments arrive
 * in either form a provider sends, nothing is stored, and what comes back is a template as it is
 * stored — expanded, every node keeping its id.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import { ensureNodeIds, forEachNode, type SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { createTemplateToolset } from '../src/templates/templateToolset';

const stored = (): SchemaNode =>
  ensureNodeIds({
    type: 'Column',
    meta: { name: 'Test', description: '', icon: 'cube' },
    props: { bg: 'page' },
    children: [{ type: 'we-text', children: ['Hello'] }],
  } as unknown as SchemaNode);

const insert = (node: unknown) => ({ patches: [{ targetId: '', insert: { children: { node } } }] });
const request = 'Add a line saying World';

const sightings: EntityManifestEntry = {
  name: 'Sighting',
  targetClass: 'community://sighting',
  properties: [
    {
      name: 'species',
      predicate: 'community://species',
      type: 'string',
      isCollection: false,
      required: true,
      writable: true,
    },
  ],
};
const listSightings = {
  type: '$each',
  props: { items: { $query: { entity: 'Sighting', limit: 10 } }, as: 'row' },
  children: [{ type: 'we-text', children: [{ $: 'row.species' }] }],
};

describe('a template toolset', () => {
  it('says what was asked, and offers the patch tool as the one edit', async () => {
    const toolset = await createTemplateToolset({ template: stored(), request });

    expect(toolset.prompt).toContain(request);
    expect(toolset.tools[0]).toMatchObject({ name: 'update_schema', kind: 'edit' });
    expect(toolset.tools.slice(1).every((tool) => tool.kind === 'lookup')).toBe(true);
  });

  it('keeps a valid edit, and gives back the template with every id it had', async () => {
    const template = stored();
    const toolset = await createTemplateToolset({ template, request });

    const answer = await toolset.call('update_schema', insert({ type: 'we-text', children: ['World'] }));
    expect(answer).not.toMatch(/^Error/);

    const { template: edited, changed, edits } = toolset.result();
    expect({ changed, edits }).toEqual({ changed: true, edits: 1 });
    const before = new Set<string>();
    forEachNode(template, (node) => void (node.id && before.add(node.id)));
    const after = new Set<string>();
    forEachNode(edited, (node) => void (node.id && after.add(node.id)));
    expect([...before].every((id) => after.has(id))).toBe(true);
    expect(after.size).toBe(before.size + 1);
  });

  it('answers a refused edit with an error the model can act on, and keeps nothing', async () => {
    const toolset = await createTemplateToolset({ template: stored(), request });

    const answer = await toolset.call('update_schema', insert({ type: 'we-nonexistent' }));
    expect(answer).toMatch(/^Error: Semantic validation failed/);
    expect(toolset.result().changed).toBe(false);
  });

  it('takes arguments as the JSON string a provider may send', async () => {
    const toolset = await createTemplateToolset({ template: stored(), request });

    await toolset.call('update_schema', JSON.stringify(insert({ type: 'we-text', children: ['World'] })));
    expect(toolset.result().edits).toBe(1);
    expect(await toolset.call('update_schema', '{not json')).toMatch(/^Error: The arguments/);
  });

  it('refuses a tool it does not have rather than throwing', async () => {
    const toolset = await createTemplateToolset({ template: stored(), request });

    expect(await toolset.call('delete_everything', {})).toBe('Error: Unknown tool: delete_everything');
  });

  it("lets a template query the dataset's own models, and tells the model what they hold", async () => {
    const without = await createTemplateToolset({ template: stored(), request });
    expect(await without.call('update_schema', insert(listSightings))).toMatch(
      /^Error: Semantic validation failed \(1 issues\).*Sighting/,
    );

    const toolset = await createTemplateToolset({ template: stored(), request, models: [sightings] });
    expect(toolset.prompt).toContain('Sighting');
    expect(toolset.prompt).toContain('species');
    expect(await toolset.call('update_schema', insert(listSightings))).not.toMatch(/^Error/);
  });
});
