/**
 * Bounding the template the editor sends.
 *
 * Two properties carry the design and are pinned first: a template that fits the budget is sent
 * exactly as it was, and above the budget the outline still names EVERY node. The second is the
 * one that would fail silently — a node missing from the outline is a node the model cannot
 * address, and the symptom is an edit that lands somewhere plausible instead.
 */
import { compactDefinitions, ensureNodeIds, type SchemaNode } from '@we/schema-shared';
import { kanbanTemplate } from '@we/template-showcase';
import { describe, expect, it } from 'vitest';

import { boundTemplate, outlineText } from '../src/shared/ai/templateContext';

const prepared = (template: unknown) =>
  ensureNodeIds(compactDefinitions(structuredClone(template) as SchemaNode).schema);

const kanban = () => prepared(kanbanTemplate);

const small = (): SchemaNode =>
  ({
    type: 'Column',
    meta: { name: 'Small', description: '', icon: 'cube' },
    props: { bg: 'page' },
    children: [{ type: 'we-text', children: ['Hello'] }],
  }) as unknown as SchemaNode;

/** Every id in a tree, definitions included. */
function idsOf(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((v) => idsOf(v, found));
    return found;
  }
  const node = value as SchemaNode;
  if (typeof node.type === 'string' && typeof node.id === 'string') found.add(node.id);
  Object.values(value as Record<string, unknown>).forEach((v) => idsOf(v, found));
  return found;
}

describe('a template that fits the budget', () => {
  it('is sent exactly as it was, with no tool and nothing to explain', () => {
    const schema = prepared(small());
    const bound = boundTemplate(schema, 'make the heading bigger');

    expect(bound.whole).toBe(true);
    expect(bound.sent).toBe(schema);
    expect(bound.tools).toEqual([]);
    expect(bound.resolveTool).toBeUndefined();
  });

  /*
    The point of a budget rather than a threshold: nothing switches shape at a boundary, and the
    whole-template case is what filling a budget DOES when everything fits, not a branch written
    for small templates. Kanban is 39K compacted, so it rides under the 60K default — which is
    deliberate, since it is a template people really edit.
  */
  it('includes a real template, at the shipped budget', () => {
    expect(boundTemplate(kanban(), 'make the cards rounder').whole).toBe(true);
  });
});

describe('a template that does not fit', () => {
  const bound = () => boundTemplate(kanban(), 'rename the Load more button', 10_000);

  it('sends an outline instead, and offers a tool to read the rest', () => {
    const result = bound();
    expect(result.whole).toBe(false);
    expect(result.tools.map((t) => t.name)).toEqual(['we_template']);
    expect(result.stats.sentChars).toBeLessThan(result.stats.templateChars);
  });

  /*
    The property the whole mechanism rests on. Ids are how a patch lands, so a node left out of
    the outline cannot be edited at all — and the failure is not an error, it is the model
    picking the nearest node it CAN see. Asserted against the tree itself rather than a count, so
    it keeps holding when the template changes.
  */
  it('names every node of the template, definitions included', () => {
    const schema = kanban();
    const { text } = outlineText(schema);
    const mentioned = new Set(text.split('\n').map((l) => l.trim().split(' ')[0]));
    const missing = [...idsOf(schema)].filter((id) => !mentioned.has(id));
    expect(missing).toEqual([]);
  });

  it('says a shared shape once, under the name its $refs point at', () => {
    const { text } = outlineText(kanban());
    expect(text).toMatch(/\$defs\.d\d+ — the shape every \$ref to "d\d+" stands for:/);
  });

  it('warns that replacing a children array deletes what was not shown', () => {
    const sent = bound().sent as { note: string };
    expect(sent.note).toMatch(/insert/);
    expect(sent.note).toMatch(/REPLACES/);
  });
});

describe('what the request pulls into detail', () => {
  it('shows the node the request names, in full', () => {
    const result = boundTemplate(kanban(), 'rename the Load more button', 10_000);
    const shown = (result.sent as { shown: Record<string, unknown> }).shown;
    expect(JSON.stringify(shown)).toContain('Load more');
  });

  /*
    A parent's detail already contains its children's, so paying for both buys nothing — and on a
    request matching a deep subtree that double-spend is most of the budget.
  */
  it('does not pay twice for a node already inside one it is showing', () => {
    const result = boundTemplate(kanban(), 'boards new board column card', 20_000);
    const shown = (result.sent as { shown: Record<string, SchemaNode> }).shown;
    const ids = Object.keys(shown);
    for (const id of ids) {
      const inside = idsOf(shown[id]);
      inside.delete(id);
      expect(ids.filter((other) => inside.has(other))).toEqual([]);
    }
  });

  /*
    The budget bounds the DETAIL, not the whole payload, because the outline is a floor it cannot
    push below: every node has to stay addressable or it cannot be patched. Worth a test saying
    so, because the natural reading of "budget" is the other one, and the gap is where a caller
    would get a surprise — on `workshopTemplate` the floor alone is 96,706 characters.
  */
  it('spends at most its share of the budget on detail, whatever the budget', () => {
    for (const budget of [8_000, 20_000, 35_000]) {
      const result = boundTemplate(kanban(), 'change the board title and the cards and the columns', budget);
      const shown = (result.sent as { shown: Record<string, unknown> }).shown;
      expect(JSON.stringify(shown).length).toBeLessThanOrEqual(budget / 2);
    }
  });

  it('is the outline that sets the floor, and says how big it is', () => {
    const result = boundTemplate(kanban(), 'tidy up', 8_000);
    expect(result.stats.outlineChars).toBeGreaterThan(0);
    expect(result.stats.sentChars).toBeGreaterThanOrEqual(result.stats.outlineChars);
    // Still far below the template it stands for — which is the point of sending it at all.
    expect(result.stats.outlineChars).toBeLessThan(result.stats.templateChars / 3);
  });
});

describe('the tool', () => {
  const resolve = (call: { name: string; arguments: Record<string, unknown> }) => {
    const result = boundTemplate(kanban(), 'tidy the board', 10_000);
    return result.resolveTool?.({ id: 'c1', ...call });
  };

  it('returns a node in full, by id', () => {
    const answer = resolve({ name: 'we_template', arguments: { ids: ['n1'] } });
    expect(answer).toContain('n1:');
    expect(answer).toContain('"type"');
  });

  it('finds nodes by what they say', () => {
    const answer = resolve({ name: 'we_template', arguments: { find: 'Load more' } });
    expect(answer).toMatch(/Load more/);
  });

  it('says so when an id is not in the template, rather than returning nothing', () => {
    expect(resolve({ name: 'we_template', arguments: { ids: ['n99999'] } })).toMatch(/No node "n99999"/);
  });

  it('leaves another tool alone', () => {
    expect(resolve({ name: 'we_reference', arguments: {} })).toBeUndefined();
  });
});
