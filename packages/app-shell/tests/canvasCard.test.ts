import { CORE_MANIFEST } from '@we/entities/manifest';
import type { EvaluationEnv } from '@we/schema-shared';
import { evaluateExpression, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { CANVAS_RECORD_CARD, canvasCard } from '../src/shared/shapes/canvasCard';
import { displayFor } from '../src/shared/shapes/recordDisplay';

const task = displayFor({
  entity: 'TaskBlock',
  label: 'Task',
  icon: 'check-square',
  schema: CORE_MANIFEST.entities.TaskBlock,
  authorable: false,
});

const states = [
  { slug: 'todo', name: 'To do', fill: '#705ec9' },
  { slug: 'in-review', name: 'In review', fill: '#f8cd51' },
];

describe('canvasCard', () => {
  it('heads a card with its kind and name, and lists what the record holds', () => {
    const card = canvasCard({
      type: 'TaskBlock',
      label: 'Ship the docs',
      data: {
        title: 'Ship the docs',
        description: 'Before Friday',
        status: 'in-review',
        priority: 'high',
        dueDate: '2026-09-14',
        assignee: '',
      },
      display: task,
      states,
      locale: 'en-GB',
    });

    expect(card.icon).toBe('check-square');
    expect(card.kind).toBe('Task');
    expect(card.title).toBe('Ship the docs');
    // The title is the heading, not a line; an empty assignee is left to the inspector.
    expect(card.lines.map((line) => line.name)).toEqual(['status', 'priority', 'dueDate']);
    expect(card.prose).toEqual([
      { name: 'description', label: '', text: 'Before Friday', swatch: '', swatchRadius: '' },
    ]);
  });

  it('shows a state by what the community calls it, in its colour', () => {
    const card = canvasCard({
      type: 'TaskBlock',
      label: 'x',
      data: { status: 'in-review' },
      display: task,
      states,
    });
    expect(card.lines[0]).toMatchObject({ label: 'Status', text: 'In review', swatch: '#f8cd51', swatchRadius: '50%' });
  });

  it('shows a slug nothing defines as itself, with no colour', () => {
    const card = canvasCard({ type: 'TaskBlock', label: 'x', data: { status: 'parked' }, display: task, states });
    expect(card.lines[0]).toMatchObject({ text: 'parked', swatch: '' });
  });

  it('reads a calendar day in UTC, so it is the same day everywhere', () => {
    const card = canvasCard({
      type: 'TaskBlock',
      label: 'x',
      data: { dueDate: '2026-09-14' },
      display: task,
      states,
      locale: 'en-GB',
    });
    expect(card.lines[0].text).toBe('14 Sept 2026');
  });

  it('keeps a value that will not parse as a date as it was stored', () => {
    const card = canvasCard({ type: 'TaskBlock', label: 'x', data: { dueDate: 'soon' }, display: task, states });
    expect(card.lines[0].text).toBe('soon');
  });

  it('leaves out false and nothing, and keeps 0', () => {
    const sighting = displayFor({
      entity: 'Sighting',
      authorable: true,
      schema: {
        properties: {
          species: { type: 'string', required: true },
          confirmed: { type: 'boolean' },
          flagged: { type: 'boolean' },
          count: { type: 'number' },
          place: { type: 'string' },
        },
        relations: {},
      },
    });
    const card = canvasCard({
      type: 'Sighting',
      label: 'heron',
      data: { species: 'heron', confirmed: true, flagged: false, count: 0, place: '' },
      display: sighting,
      states,
    });
    expect(card.lines.map((line) => [line.name, line.text])).toEqual([
      ['confirmed', 'Yes'],
      ['count', '0'],
    ]);
  });

  it('carries the counts the seed read, and nothing for a card nobody has touched', () => {
    const touched = canvasCard({
      type: 'TaskBlock',
      label: 'x',
      data: { signalsCount: 3, commentsCount: 2 },
      display: task,
      states,
    });
    expect(touched).toMatchObject({ signals: 3, comments: 2 });
    // The seed leaves a zero out entirely, so the card has to read an absent field as nothing —
    // and a count is never a *line*, which would caption the card "Signals count: 3".
    const untouched = canvasCard({ type: 'TaskBlock', label: 'x', data: {}, display: task, states });
    expect(untouched).toMatchObject({ signals: 0, comments: 0 });
    expect(touched.lines.map((line) => line.name)).toEqual([]);
  });

  it('draws no heading for a record with no name, since the header already says what it is', () => {
    const card = canvasCard({ type: 'TaskBlock', label: 'TaskBlock', data: {}, display: task, states });
    expect(card.title).toBe('');
  });

  it('still says what a record is when its model is unknown', () => {
    const card = canvasCard({
      type: 'SightingBlock',
      label: 'A heron',
      data: { species: 'heron' },
      display: undefined,
      states,
    });
    expect(card).toMatchObject({ icon: 'cube', kind: 'Sighting', title: 'A heron', lines: [], prose: [] });
  });
});

describe('CANVAS_RECORD_CARD', () => {
  const expressions: string[] = [];
  const types: string[] = [];
  (function walk(value: unknown): void {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ === 'string') expressions.push(record.$);
    if (typeof record.type === 'string') types.push(record.type);
    Object.values(record).forEach(walk);
  })(CANVAS_RECORD_CARD);

  const evaluate = (source: string, scope: Record<string, unknown>) => {
    const env: EvaluationEnv = {
      root: (name) => ({ bound: name in scope, value: scope[name] }),
      call: () => undefined,
    };
    return evaluateExpression(parseExpression(source), env);
  };

  it('parses', () => {
    expect(expressions.length).toBeGreaterThan(0);
    for (const source of expressions) expect(() => parseExpression(source)).not.toThrow();
  });

  /*
    The fragment has to wrap to a shaped card, which a flex box cannot, and has to keep pointer events
    off, which `$if`'s wrapper does not. See the fragment's own docblock.
  */
  it('uses no flex layout component and no conditional wrapper', () => {
    expect(types.filter((type) => ['Row', 'Column', 'Grid', '$if', '$animate'].includes(type))).toEqual([]);
  });

  it('hides a caption and a swatch that have nothing to show', () => {
    const caption = expressions.find((source) => source.startsWith('line.label ?')) ?? '';
    const swatch = expressions.find((source) => source.startsWith('line.swatch ?')) ?? '';
    expect(evaluate(caption, { line: { label: '' } })).toBe('display: none;');
    expect(evaluate(caption, { line: { label: 'Status' } })).toContain('opacity');
    expect(evaluate(swatch, { line: { swatch: '' } })).toBe('display: none;');
    expect(evaluate(swatch, { line: { swatch: '#f8cd51', swatchRadius: '50%' } })).toContain(
      'border-radius: 50%; background: #f8cd51;',
    );
  });

  it('draws the reaction and reply counts only where there are any', () => {
    // A canvas of untouched cards must gain no furniture at all — the rule the board and calendar
    // summaries follow, expressed here as `display: none` because the fragment cannot use `$if`.
    const line = expressions.find((source) => source.startsWith('card.signals || card.comments ?')) ?? '';
    const reactions = expressions.find((source) => source.startsWith('card.signals ?')) ?? '';
    const replies = expressions.find((source) => source.startsWith('card.comments ?')) ?? '';
    expect(evaluate(line, { card: { signals: 0, comments: 0 } })).toBe('display: none;');
    expect(evaluate(line, { card: { signals: 0, comments: 2 } })).toContain('font-size');
    expect(evaluate(reactions, { card: { signals: 0 } })).toBe('display: none;');
    expect(evaluate(replies, { card: { comments: 0 } })).toBe('display: none;');
  });

  it('says "suggested" on a draft, floated clear of the shape, and nothing on an agreed card', () => {
    // A draft on a board and in the calendar carries the badge; the canvas said it by fade alone.
    const badge = expressions.find((source) => source.startsWith('card.pending ?')) ?? '';
    expect(evaluate(badge, { card: { pending: true } })).toContain('float: right');
    expect(evaluate(badge, { card: { pending: false } })).toBe('display: none;');
    expect(evaluate(badge, { card: { pending: true } })).toContain('var(--we-role-warning)');
    expect(canvasCard({ type: 'TaskBlock', label: 'x', data: { pending: true }, display: task, states }).pending).toBe(
      true,
    );
    expect(canvasCard({ type: 'TaskBlock', label: 'x', data: {}, display: task, states }).pending).toBe(false);
  });
});
