/**
 * `template_create` as a host calls it: no record to edit, an answer naming the new record's entity
 * and place, and properties the host writes as the app's own save would.
 *
 * What is pinned: every starting template is one the editor would accept, so a new template is never
 * born broken; a whole schema or a fork is judged as an edit is; an app is only ever the person's;
 * and two templates made with the same name never take the same id.
 */
import { decodeTemplateFile, encodeTemplateFile } from '@we/entities';
import { buildValidationContext, contextData, type SchemaNode, type TemplateSchema } from '@we/schema-shared';
import { trelloTemplate } from '@we/template-showcase';
import { describe, expect, it } from 'vitest';

import type { RecordInput } from '../src/core/toolset';
import { starterTemplate, TEMPLATE_ROLES } from '../src/templates/starterTemplates';
import { judgeTemplate } from '../src/templates/templateSession';
import { TEMPLATE_CREATE, TEMPLATE_READ, templateToolset } from '../src/templates/templateToolset';

const create = (args: unknown, input: Partial<Parameters<typeof templateToolset.call>[1]> = {}) =>
  templateToolset.call(TEMPLATE_CREATE, { args, ...input });
const written = (properties: Record<string, unknown> | undefined) =>
  decodeTemplateFile<TemplateSchema & { author?: string }>(properties?.schema)!;
const asRecord = (template: TemplateSchema): RecordInput => ({
  id: 'record-1',
  className: 'Template',
  properties: { name: template.meta.name, version: 4, schema: encodeTemplateFile(template) },
});

describe('the starting templates', () => {
  it('are each one the editor would accept as it is', () => {
    const context = buildValidationContext(contextData);
    for (const role of TEMPLATE_ROLES)
      expect(judgeTemplate(starterTemplate(role, 'New', 'new') as SchemaNode, context), role).toBeUndefined();
  });
});

describe('template_create', () => {
  it('makes a shell in the person’s library by default, with the fields the app’s own save writes', async () => {
    const answer = await create({ name: 'Lending Desk', description: 'Borrow a drill', icon: 'wrench' });
    expect(answer.text).not.toMatch(/^Error/);
    expect(answer.text).toContain(TEMPLATE_READ);
    expect(answer.create).toEqual({ entity: 'Template', place: 'library' });
    const { slug, ...rest } = answer.properties!;
    expect(rest).toMatchObject({
      name: 'Lending Desk',
      description: 'Borrow a drill',
      icon: 'wrench',
      origin: 'custom',
      version: 1,
      role: '',
    });
    expect(slug).toMatch(/^lending-desk-[a-z0-9]+$/);
    const template = written(answer.properties);
    expect(template.id).toBe(slug);
    expect(template.meta).toMatchObject({ name: 'Lending Desk', description: 'Borrow a drill', icon: 'wrench' });
  });

  it('gives two templates of the same name different ids, so neither replaces the other', async () => {
    const [a, b] = await Promise.all([create({ name: 'Board' }), create({ name: 'Board' })]);
    expect(a.properties!.slug).not.toBe(b.properties!.slug);
  });

  it('makes a view, which says so where a list can filter on it, and suggests a segment from its name', async () => {
    const answer = await create({ name: 'Loans', role: 'view' });
    expect(answer.properties!.role).toBe('view');
    expect(written(answer.properties).meta).toMatchObject({ role: 'view', segment: 'loans' });
  });

  it('makes a template in the space when asked, as the app marks a space’s own', async () => {
    const answer = await create({ name: 'Shared board', place: 'space' });
    expect(answer.create).toEqual({ entity: 'Template', place: 'space' });
    expect(answer.properties!.origin).toBe('shared');
  });

  it('keeps an app in the person’s library', async () => {
    const answer = await create({ name: 'My chrome', role: 'app', place: 'space' });
    expect(answer.text).toMatch(/^Error: An app/);
    expect(answer.properties).toBeUndefined();
    expect((await create({ name: 'My chrome', role: 'app' })).create).toEqual({ entity: 'Template', place: 'library' });
  });

  it('records who made it when told, and drops whoever saved the template it was forked from', async () => {
    const source = { ...trelloTemplate, author: 'did:somebody-else' } as TemplateSchema;
    const answer = await create({ name: 'My kanban' }, { record: asRecord(source), author: 'did:me' });
    expect(answer.text).not.toMatch(/^Error/);
    const template = written(answer.properties);
    expect(template.author).toBe('did:me');
    expect(template.meta.name).toBe('My kanban');
    expect(template.routes?.map((r) => r.path)).toEqual(trelloTemplate.routes?.map((r) => r.path));
  });

  it('refuses a role the template it forks is not', async () => {
    const answer = await create({ name: 'X', role: 'view' }, { record: asRecord(trelloTemplate as TemplateSchema) });
    expect(answer.text).toMatch(/^Error: The template to start from is a shell/);
  });

  it('judges a whole schema as an edit is judged, and saves nothing it refuses', async () => {
    const broken = { type: 'Column', meta: { name: 'x' }, children: [{ type: 'NoSuchComponent' }] };
    const answer = await create({ name: 'Broken', schema: broken });
    expect(answer.text).toMatch(/^Error: (Structural|Semantic) validation failed/);
    expect(answer.properties).toBeUndefined();

    const fine = { type: 'Column', meta: { name: 'x' }, children: [{ type: 'we-text', children: ['Hi'] }] };
    const made = await create({ name: 'Fine', schema: fine });
    expect(made.text).not.toMatch(/^Error/);
    expect(written(made.properties).meta.name).toBe('Fine');
  });

  it('checks a dry run and saves nothing', async () => {
    const answer = await create({ name: 'Trial', dry_run: true });
    expect(answer.text).toMatch(/^Valid/);
    expect(answer.properties).toBeUndefined();
    expect(answer.create).toBeUndefined();
  });

  it('answers a call it cannot act on with an error, never a throw', async () => {
    expect((await create({})).text).toMatch(/^Error: Give the template a `name`/);
    expect((await create({ name: 'x', role: 'page' })).text).toMatch(/^Error: `role`/);
    expect((await create({ name: 'x', place: 'elsewhere' })).text).toMatch(/^Error: `place`/);
    expect((await create({ name: 'x', schema: 'nope' })).text).toMatch(/^Error: `schema`/);
    expect((await create('{"name": "From a string"}')).properties!.name).toBe('From a string');
  });
});
