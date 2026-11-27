import { describe, expect, it } from 'vitest';

import type { TextContentBlock } from './content';
import { markdownToBlocks } from './markdown';
import type { StandoffMark } from './marks';

const cp = (text: string, needle: string) => {
  const at = text.indexOf(needle);
  const start = Array.from(text.slice(0, at)).length;
  return { start, end: start + Array.from(needle).length };
};
/** The words a block's marks of `type` cover. */
const covered = (b: TextContentBlock, type: string) =>
  (b.marks ?? []).filter((m) => m.type === type).map((m) => Array.from(b.text).slice(m.start, m.end).join(''));

describe('markdownToBlocks', () => {
  it('draws headings, paragraphs and emphasis', () => {
    const [h, p] = markdownToBlocks(
      '## Nightly on dev\n\n**Only llm-e2e passed.** The rest *failed* ~~again~~.',
    ) as TextContentBlock[];
    expect(h).toMatchObject({ _type: 'block', style: 'h2', text: 'Nightly on dev' });
    expect(p.text).toBe('Only llm-e2e passed. The rest failed again.');
    expect(covered(p, 'strong')).toEqual(['Only llm-e2e passed.']);
    expect(covered(p, 'em')).toEqual(['failed']);
    expect(covered(p, 'strike')).toEqual(['again']);
  });

  it('caps a deep heading at the deepest style a block has', () => {
    expect(markdownToBlocks('#### Four')[0]).toMatchObject({ style: 'h3', text: 'Four' });
  });

  it('keeps a single line break as a break, as chat writes it', () => {
    expect(markdownToBlocks('one\ntwo')[0]).toMatchObject({ text: 'one\ntwo' });
  });

  it('draws lists as list items, nested and numbered and checked', () => {
    const out = markdownToBlocks('- a\n  - b\n1. c\n\n- [x] done\n- [ ] not') as TextContentBlock[];
    expect(out.map((b) => [b.text, b.listItem, b.level, b.checked])).toEqual([
      ['a', 'bullet', undefined, undefined],
      ['b', 'bullet', 1, undefined],
      ['c', 'number', undefined, undefined],
      ['done', 'check', undefined, true],
      ['not', 'check', undefined, false],
    ]);
  });

  it('draws inline code as a code mark, its characters as written', () => {
    const [p] = markdownToBlocks('run `docker: command not found` and `<b>&amp;</b>`') as TextContentBlock[];
    expect(covered(p, 'code')).toEqual(['docker: command not found', '<b>&amp;</b>']);
  });

  it('draws a fence as a code block, a rule as a divider, and a table as code', () => {
    const out = markdownToBlocks('```ts\nconst a = 1;\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toEqual([
      { _type: 'code', code: 'const a = 1;', language: 'ts' },
      { _type: 'divider' },
      { _type: 'code', code: '| a | b |\n|---|---|\n| 1 | 2 |', language: '' },
    ]);
  });

  it('draws a quote as quote blocks', () => {
    expect(markdownToBlocks('> said it\n> twice')[0]).toMatchObject({ style: 'blockquote', text: 'said it\ntwice' });
  });

  it('links written and bare URLs, and drops an href nobody should open', () => {
    const [p] = markdownToBlocks(
      '[the review](https://github.com/coasys/ad4m/pull/1861), https://x.org/a. and [bad](javascript:alert(1))',
    ) as TextContentBlock[];
    expect(p.text).toBe('the review, https://x.org/a. and bad');
    expect((p.marks ?? []).filter((m) => m.type === 'link').map((m) => m.href)).toEqual([
      'https://github.com/coasys/ad4m/pull/1861',
      'https://x.org/a',
    ]);
  });

  it('keeps the writer’s mention where its words end up', () => {
    const text = '**Ready** for @Josh: see `#1897`';
    const marks: StandoffMark[] = [{ ...cp(text, '@Josh'), type: 'mention', did: 'did:key:z6Mk(josh)' }];
    const [p] = markdownToBlocks(text, marks) as TextContentBlock[];
    expect(p.text).toBe('Ready for @Josh: see #1897');
    expect(covered(p, 'mention')).toEqual(['@Josh']);
    expect(p.marks?.find((m) => m.type === 'mention')).toMatchObject({ did: 'did:key:z6Mk(josh)' });
  });

  it('counts the writer’s offsets in code points, past an emoji', () => {
    const text = '🚀 **done** @Hex';
    const [p] = markdownToBlocks(text, [
      { ...cp(text, '@Hex'), type: 'mention', did: 'did:hex' },
    ]) as TextContentBlock[];
    expect(covered(p, 'mention')).toEqual(['@Hex']);
    expect(covered(p, 'strong')).toEqual(['done']);
  });

  it('keeps a mention inside a list item', () => {
    const text = '- ask @Data about it\n- then ship';
    const [a] = markdownToBlocks(text, [
      { ...cp(text, '@Data'), type: 'mention', did: 'did:data' },
    ]) as TextContentBlock[];
    expect(a).toMatchObject({ listItem: 'bullet', text: 'ask @Data about it' });
    expect(covered(a, 'mention')).toEqual(['@Data']);
  });

  it('draws raw HTML as its words, never as markup', () => {
    const out = markdownToBlocks('<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>') as TextContentBlock[];
    expect(out.map((b) => b.text)).toEqual(['<script>alert(1)</script>', 'hi <img src=x onerror=alert(1)>']);
  });

  it('turns character references into characters', () => {
    expect(markdownToBlocks('a &amp; b &lt;c&gt; &#x1F680;')[0]).toMatchObject({ text: 'a & b <c> 🚀' });
  });

  it('draws an image as its alt text, linked, without fetching it', () => {
    const [p] = markdownToBlocks('![the graph](https://x.org/g.png)') as TextContentBlock[];
    expect(p.text).toBe('the graph');
    expect(p.marks).toEqual([{ start: 0, end: 9, type: 'link', href: 'https://x.org/g.png' }]);
  });

  it('keeps the composer’s own bold and link, over words with no markdown in them', () => {
    const text = 'ship it today, see the plan';
    const marks: StandoffMark[] = [
      { ...cp(text, 'today'), type: 'strong' },
      { ...cp(text, 'the plan'), type: 'link', href: 'https://x.org/plan' },
    ];
    const [p] = markdownToBlocks(text, marks) as TextContentBlock[];
    expect(p.text).toBe(text);
    expect(covered(p, 'strong')).toEqual(['today']);
    expect(covered(p, 'link')).toEqual(['the plan']);
  });

  it('keeps a mention inside inline code', () => {
    const text = 'run `ping @Hex` now';
    const [p] = markdownToBlocks(text, [
      { ...cp(text, '@Hex'), type: 'mention', did: 'did:hex' },
    ]) as TextContentBlock[];
    expect(p.text).toBe('run ping @Hex now');
    expect(covered(p, 'mention')).toEqual(['@Hex']);
    expect(covered(p, 'code')).toEqual(['ping @Hex']);
  });

  it('splits a mark across the blocks its words end up in', () => {
    const text = 'first part\n\nsecond part';
    const [a, b] = markdownToBlocks(text, [{ ...cp(text, 'part\n\nsecond'), type: 'em' }]) as TextContentBlock[];
    expect(covered(a, 'em')).toEqual(['part']);
    expect(covered(b, 'em')).toEqual(['second']);
  });

  it('drops a mark inside a code block, and leaves no trace of it', () => {
    const text = '```\nping @Hex\n```';
    const out = markdownToBlocks(text, [{ ...cp(text, '@Hex'), type: 'mention', did: 'did:hex' }]);
    expect(out).toEqual([{ _type: 'code', code: 'ping @Hex', language: '' }]);
  });

  it('never leaves a carried mark’s characters in what it draws', () => {
    const text = '# @Hex\n\n- **@Data** and [@Josh](https://x.org)\n\n> @Hex';
    const marks = ['@Hex', '@Data', '@Josh'].map((n) => ({ ...cp(text, n), type: 'mention', did: n }));
    const all = JSON.stringify(markdownToBlocks(text, marks));
    expect(all).not.toMatch(/[\ue000-\uf8ff]/);
  });

  it('draws a line with no markdown in it as the one block it always was', () => {
    expect(markdownToBlocks('just words, 2 * 3 = 6')).toEqual([
      { _type: 'block', text: 'just words, 2 * 3 = 6', marks: [] },
    ]);
  });

  it('ends a list or a quote at a line back at the margin, as chat does', () => {
    const out = markdownToBlocks('1. first\n2. second\nAlso open: #1864\n\n> said\nthen this') as TextContentBlock[];
    expect(out.map((b) => [b.text, b.listItem ?? b.style ?? ''])).toEqual([
      ['first', 'number'],
      ['second', 'number'],
      ['Also open: #1864', ''],
      ['said', 'blockquote'],
      ['then this', ''],
    ]);
  });

  it('lets an indented line continue its item, and leaves a code fence alone', () => {
    const out = markdownToBlocks('- item\n  more of it\n\n```\n- not a list\nplain\n```') as TextContentBlock[];
    expect(out[0]).toMatchObject({ listItem: 'bullet', text: 'item\nmore of it' });
    expect(out[1]).toEqual({ _type: 'code', code: '- not a list\nplain', language: '' });
  });

  it('keeps the writer’s marks across the line it splits off', () => {
    const text = '- one\n@Hex see above';
    const [, p] = markdownToBlocks(text, [
      { ...cp(text, '@Hex'), type: 'mention', did: 'did:hex' },
    ]) as TextContentBlock[];
    expect(p.text).toBe('@Hex see above');
    expect(covered(p, 'mention')).toEqual(['@Hex']);
  });
});
