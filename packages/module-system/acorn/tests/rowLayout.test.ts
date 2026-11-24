/**
 * The outcome row's space contract — the layout guarantee the live suite's
 * `getByRole('textbox', { name: <content> })` leans on: the content field must always
 * keep a nonzero width. The row is `Column[content+notes] flex 1 1 auto min-width:0`
 * beside a `Row[tag buttons, untag, delete]`. `min-width:0` on the column is correct —
 * the inputs *should* shrink first — but it only stays honest if the buttons row can
 * give ground back: `flex: '0 1 auto'` lets it shrink below its max-content and `wrap`
 * lets the tags spill onto a second line. With `flex: '0 0 auto'` (unshrinkable), each
 * `Tag <text> → <content>` button priced in a full content label, and two seeded tags
 * squeezed the column to 0 px — the input in the DOM but invisible to Playwright.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { ACORN_PARTS } from '../src/index.ts';

/** Depth-first walk for the first node the predicate accepts. */
function find(node: SchemaNode, pred: (n: SchemaNode) => boolean): SchemaNode | undefined {
  if (pred(node)) return node;
  for (const child of (node.children ?? []) as SchemaNode[]) {
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return undefined;
}

const isRow = (n: SchemaNode) => n.type === 'Row';
const rendersTagButtons = (n: SchemaNode) =>
  !!find(
    n,
    (c) => c.type === '$each' && (c.props?.items as { $query?: { entity?: string } })?.$query?.entity === 'AcornTag',
  );

/** Every Row holding the tag buttons — outermost first; the buttons' own row is the deepest. */
function rowsWithTags(node: SchemaNode): SchemaNode[] {
  const rows: SchemaNode[] = [];
  if (isRow(node) && rendersTagButtons(node)) rows.push(node);
  for (const child of (node.children ?? []) as SchemaNode[]) rows.push(...rowsWithTags(child));
  return rows;
}

describe('acorn.outcomeList — the row keeps its content field visible', () => {
  it('the tag/untag/delete row can shrink below max-content and wrap', () => {
    const part = ACORN_PARTS.outcomeList;
    expect(part).toBeDefined();
    const rows = rowsWithTags(part.node);
    const buttonsRow = rows[rows.length - 1];
    expect(buttonsRow, 'the outcome row must carry its action buttons in a Row').toBeDefined();
    expect(buttonsRow!.props?.wrap).toBe(true);
    // Shrinkable (`0 1 auto`), never grown — and min-width 0 so wrap actually folds it.
    expect(buttonsRow!.props?.flex).toBe('0 1 auto');
    expect(buttonsRow!.props?.minWidth).toBe('0');
  });
});
