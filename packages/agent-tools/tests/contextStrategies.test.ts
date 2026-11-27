/**
 * The three ways of telling the editor's model about WE, cut from the real generated reference.
 *
 * The property that matters for a fair comparison is coverage: whatever a strategy leaves out of the
 * system prompt must still be reachable through its tools, or the eval would be measuring a strategy
 * that simply knows less. The other guard is drift — the strategies name the reference's headings,
 * so a renamed heading has to fail here rather than quietly drop a section.
 */
import { schemaContext } from '@we/ai-context';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { chatSystemPreamble } from '../src/templates/chatSystemPrompt';
import { fullContext, lookupContext, sectionsContext, splitReference } from '../src/templates/contextStrategies';

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: 'c', name, arguments: args });
/** A Stores entry's heading: the name a template writes, then what it is. */
const entry = (name: string) => new RegExp(`^${name} \\([^)]*\\):$`, 'm');

const schema = {
  type: 'Column',
  meta: { name: 'T', description: '', icon: 'cube' },
  children: [{ type: 'we-avatar', props: { image: { $: 'identity.ownProfile.avatar' } } }],
} as unknown as SchemaNode;

describe('splitting the reference', () => {
  it('loses nothing and reorders nothing', () => {
    const sections = splitReference(schemaContext);
    expect(sections.map((s) => s.text).join('\n')).toBe(schemaContext);
    expect(sections.length).toBeGreaterThan(10);
  });
});

describe('the sections strategy', () => {
  const prepared = sectionsContext(chatSystemPreamble, schemaContext);
  const storesText = splitReference(schemaContext).find((s) => s.title === 'Stores')!.text;

  it('keeps every section reachable, in the prompt or behind exactly one tool', () => {
    const loaded = prepared.tools.map((tool) => prepared.resolveTool!(call(tool.name))!);
    for (const { title, text } of splitReference(schemaContext)) {
      // Stores is the one section handed over a store at a time rather than whole — see below.
      if (!title || title === 'Stores') continue;
      const places = [prepared.system, ...loaded].filter((place) => place.includes(text));
      expect(places, title).toHaveLength(1);
    }
  });

  it('reaches the stores by name, several at once', () => {
    const answer = prepared.resolveTool!(call('we_stores_reference', { stores: ['spaceStore', 'themeStore'] }))!;
    expect(answer).toMatch(entry('spaceStore'));
    expect(answer).toMatch(entry('themeStore'));
    expect(answer).not.toMatch(entry('recordStore'));
  });

  it('names every store it will answer for, in the directory and in the tool', () => {
    const tool = prepared.tools.find((t) => t.name === 'we_stores_reference')!;
    const names = [...storesText.matchAll(/^([a-z]\w*) \([^)]*\):$/gm)].map((m) => m[1]);
    expect(names).toContain('navigation');
    expect(names).toContain('spaceStore');
    for (const name of names) {
      expect(prepared.system, name).toContain(name);
      expect(tool.description, name).toContain(name);
    }
  });

  /**
   * The reason this tool takes names. Handed over whole the Stores section is most of the window
   * this strategy exists to leave free, so one call would spend the budget and leave nowhere to put
   * the answer.
   */
  it('hands over a fraction of the section for the stores a request actually touches', () => {
    const answer = prepared.resolveTool!(call('we_stores_reference', { stores: ['spaceStore'] }))!;
    expect(answer.length).toBeLessThan(storesText.length / 3);
  });

  it('says what it takes rather than answering an empty call with everything', () => {
    const answer = prepared.resolveTool!(call('we_stores_reference'))!;
    expect(answer).toMatch(/Name the stores you want/);
    expect(answer.length).toBeLessThan(storesText.length / 10);
  });

  it('sends a much smaller prompt than the full reference', () => {
    expect(prepared.system.length).toBeLessThan(fullContext(chatSystemPreamble, schemaContext).system.length / 3);
  });

  it('does not answer a tool that is not one of its own', () => {
    expect(prepared.resolveTool!(call('we_reference'))).toBeUndefined();
  });
});

describe('the lookup strategy', () => {
  it('preselects what the template uses and what the request names', () => {
    const prepared = lookupContext(chatSystemPreamble, schemaContext, {
      request: 'Add a button that shows the member count from spaceStore',
      schema,
    });

    expect(prepared.system).toMatch(/^- we-avatar /m);
    expect(prepared.system).toMatch(/^- we-button /m);
    expect(prepared.system).toMatch(entry('identity'));
    expect(prepared.system).toMatch(entry('spaceStore'));
    // Not implicated, so left to a lookup.
    expect(prepared.system).not.toMatch(entry('themeStore'));
  });

  it('looks up components, stores and sections by name, several at once', () => {
    const prepared = lookupContext(chatSystemPreamble, schemaContext, { request: 'x', schema });
    const answer = prepared.resolveTool!(
      call('we_reference', { components: ['Grid'], stores: ['themeStore'], sections: ['panels'] }),
    )!;

    expect(answer).toMatch(/^- Grid /m);
    expect(answer).toMatch(entry('themeStore'));
    expect(answer).toContain('## Panels');
  });

  it('says so, with suggestions, when a name does not exist', () => {
    const prepared = lookupContext(chatSystemPreamble, schemaContext, { request: 'x', schema });
    expect(prepared.resolveTool!(call('we_reference', { components: ['button'] }))).toMatch(
      /No component named "button"\. Did you mean: .*we-button/,
    );
  });

  it('can reach every section of the reference, one way or another', () => {
    const prepared = lookupContext(chatSystemPreamble, schemaContext, { request: 'x', schema });
    const everything = prepared.resolveTool!(
      call('we_reference', { sections: ['patterns', 'plugins', 'panels', 'storePatterns', 'modules', 'operations'] }),
    )!;
    for (const { title, text } of splitReference(schemaContext)) {
      if (!title || title === 'Component Registry' || title === 'Stores') continue;
      expect(prepared.system.includes(text) || everything.includes(text), title).toBe(true);
    }
  });
});
