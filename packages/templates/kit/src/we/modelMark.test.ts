import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { modelMark } from './modelMark.ts';

/**
 * The mark, checked by running its expressions. `generatedRun` is the host's (tested in
 * `@we/entities`); it stands in here by its rule — a record with a `generatedBy` was made by a run —
 * so what this checks is that the mark asks it about the right record, and what it then says.
 */
const generatedRun = ([options]: unknown[]) => {
  const record = (options as { record?: { generatedBy?: string } }).record;
  return record?.generatedBy ? { by: 'run', run: record.generatedBy } : null;
};

const run = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) => ({ bound: name in roots, value: roots[name] }),
    call: (name: string, args: unknown[]) =>
      name === 'generatedRun'
        ? generatedRun(args)
        : listFunctions()
            .find((f) => f.name === name)
            ?.impl(args, {} as never),
  } as never);

type Node = { props: Record<string, { $: string }> & { then: unknown } };

const condition = (opts: Parameters<typeof modelMark>[0]) => (modelMark(opts) as unknown as Node).props.condition.$;
const words = (as: string) => {
  const text = JSON.stringify(modelMark({ as })).match(/"text":\{"\$":"((?:[^"\\]|\\.)*)"\}/);
  return JSON.parse(`"${text![1]}"`) as string;
};

const me = { did: 'did:me' };
const author = { did: 'did:me', name: 'Me' };

describe('the model mark', () => {
  it('is on a record a run made, and not on one a person made', () => {
    expect(run(condition({ as: 'card' }), { card: { generatedBy: 'run-1' } })).toBeTruthy();
    expect(run(condition({ as: 'card' }), { card: {} })).toBeFalsy();
    expect(run(condition({ as: 'event' }), { event: { generatedBy: 'run-1' } })).toBeTruthy();
  });

  it('takes a caller’s wider reading too, for what came out of a conversation with no run on it', () => {
    const wide = condition({ as: 'card', extracted: 'card.extractedFrom' });
    expect(run(wide, { card: { extractedFrom: 'call-1' } })).toBe(true);
    expect(run(wide, { card: { generatedBy: 'run-1' } })).toBe(true);
    expect(run(wide, { card: {} })).toBe(false);
  });

  it('says it was extracted where the record came out of a conversation, and written by AI otherwise', () => {
    expect(run(words('card'), { card: { extractedFrom: 'call-1' }, author, me })).toBe(
      'Extracted from the conversation · run by you',
    );
    expect(run(words('card'), { card: {}, author: { did: 'did:sam', name: 'Sam' }, me })).toBe(
      'Written by AI · run by Sam',
    );
  });
});
