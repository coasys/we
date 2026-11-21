import { evaluateExpression, parseExpression, type SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { agentByline, VERDICT_WORDS, verdictMark } from './agentByline.ts';

/**
 * The verdict mark, checked by running its expressions: a quiet icon for an author the backend could
 * not confirm, and nothing for anyone else.
 */
const run = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) => ({ bound: name in roots, value: roots[name] }),
    call: () => undefined,
  } as never);

type IfNode = { type: string; props: { condition: { $: string }; then: SchemaNode } };

const mark = verdictMark('mention.verdict') as unknown as IfNode;
const tooltip = mark.props.then as unknown as { props: { content: { $: string } }; children: SchemaNode[] };
const icon = tooltip.children[0] as unknown as { type: string; props: Record<string, unknown> };
const at = (verdict: unknown) => ({ mention: { verdict } });

describe('the verdict mark', () => {
  it('shows for cantCheck and flagged, and for nothing else', () => {
    expect(mark.type).toBe('$if');
    expect(run(mark.props.condition.$, at('cantCheck'))).toBe(true);
    expect(run(mark.props.condition.$, at('flagged'))).toBe(true);
    // A valid author is not marked; a refused one never reaches a template, but would not be either.
    expect(run(mark.props.condition.$, at('valid'))).toBe(false);
    expect(run(mark.props.condition.$, at('invalid'))).toBe(false);
    expect(run(mark.props.condition.$, at(undefined))).toBe(false);
  });

  it('says why, quietly: an existing tooltip around a faint icon', () => {
    expect(tooltip).toMatchObject({ type: 'we-tooltip' });
    expect(icon.type).toBe('we-icon');
    expect(icon.props).toMatchObject({ size: 'xs', color: 'text-faint' });
    expect(run(tooltip.props.content.$, at('cantCheck'))).toBe(VERDICT_WORDS.cantCheck);
    expect(run(tooltip.props.content.$, at('flagged'))).toBe(VERDICT_WORDS.flagged);
    expect(run((icon.props.name as { $: string }).$, at('cantCheck'))).toBe('question');
    expect(run((icon.props.name as { $: string }).$, at('flagged'))).toBe('warning');
  });

  it('sits after the name in a byline that asks for it, and is absent from one that does not', () => {
    const types = (node: SchemaNode) => JSON.stringify(node).includes('mention.verdict');
    expect(types(agentByline({ did: { $: 'mention.author' }, verdict: 'mention.verdict' }))).toBe(true);
    expect(types(agentByline({ did: { $: 'mention.author' }, verdict: 'mention.verdict', stacked: true }))).toBe(true);
    expect(JSON.stringify(agentByline({ did: { $: 'mention.author' } }))).not.toContain('verdict');

    const row = (
      agentByline({ did: { $: 'mention.author' }, verdict: 'mention.verdict' }) as unknown as {
        children: [{ children: SchemaNode[] }];
      }
    ).children[0].children;
    expect(row.map((n) => (n as { type: string }).type)).toEqual(['we-avatar', 'we-text', '$if']);
  });
});
