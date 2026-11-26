/**
 * Markdown-style shortcuts while typing: `# ` for a heading, `- ` for a list, `**bold**`, a URL
 * followed by a space becomes a link. The block rules keep the block's `id` — a paragraph that
 * becomes a heading is still the same block to the store.
 */
import { findUrls } from '@we/block-shared';
import { safeHref } from '@we/design-utils';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { MarkType, NodeType, Schema } from 'prosemirror-model';
import type { EditorState, Plugin, Transaction } from 'prosemirror-state';

import { isTextNodeType } from '../schema';

/** Change the textblock the match sits in, merging the matched attrs over the ones it has. */
function blockRule(
  regex: RegExp,
  type: NodeType,
  attrsFor: (match: RegExpMatchArray) => Record<string, unknown> = () => ({}),
): InputRule {
  return new InputRule(regex, (state: EditorState, match, start, end): Transaction | null => {
    const $start = state.doc.resolve(start);
    const parent = $start.parent;
    if (!parent.type.isTextblock || !isTextNodeType(parent.type.name)) return null;
    // Only at the very start of the block — `#` mid-sentence is a character.
    if ($start.parentOffset !== 0) return null;
    const attrs = { ...parent.attrs, ...attrsFor(match) };
    return state.tr.delete(start, end).setBlockType(start, start, type, attrs);
  });
}

/** Wrap the inner capture of a `**text**`-style token in a mark, deleting the delimiters. */
function markRule(regex: RegExp, mark: MarkType): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const token = match[1];
    const content = match[2];
    if (!token || !content) return null;
    const tokenStart = end - token.length;
    const tr = state.tr;
    tr.delete(tokenStart, end);
    tr.insertText(content, tokenStart);
    tr.addMark(tokenStart, tokenStart + content.length, mark.create());
    tr.removeStoredMark(mark);
    return tr;
  });
}

/** A word that starts like a URL, then the space that ends it. Where the URL itself ends is `findUrls`'s. */
const URL_RULE = /(?:^|\s)((?:https?:\/\/|www\.)[^\s<>"']+)[\s]$/;

/**
 * A URL followed by a space becomes a link — the space is kept, the URL is marked.
 *
 * What the sentence put after the URL stays text: "…/pull/19." links up to the 9, as a URL found in
 * somebody else's line does, because both ask `findUrls` where it ends.
 */
function autolinkRule(link: MarkType): InputRule {
  return new InputRule(URL_RULE, (state, match, start, end) => {
    const word = match[1];
    const [found] = word ? findUrls(word) : [];
    if (!found || found.start !== 0) return null;
    const url = word.slice(0, found.end);
    /*
      The space just typed is not in the document yet — `end` is where it is about to go — so the
      word ends at `end`. This was `end - 1 - length` once, which linked the space before the URL and
      left its last character out: "see https://example.org/a " opened "https://example.org/".
    */
    const urlStart = end - word.length;
    /*
      Through `safeHref`, exactly as the paste path is.

      This is the third renderer of a stored href in the content layer and it went in raw, which is
      the same class of gap twice in one package: an autolinked URL becomes a link mark, the mark's
      `toDOM` builds a live `<a>` in the app origin, and the text was typed by whoever wrote the
      post. Refused rather than linked — a `javascript:` URL somebody typed is not a link, and
      leaving the text unlinked is the honest outcome.
    */
    const href = safeHref(found.href);
    if (!href) return null;
    const tr = state.tr.insertText(' ', end, end);
    tr.addMark(urlStart, urlStart + url.length, link.create({ href }));
    tr.removeStoredMark(link);
    return tr;
  });
}

export function composerInputRules(schema: Schema): Plugin {
  const { nodes, marks } = schema;
  return inputRules({
    rules: [
      blockRule(/^(#{1,3})\s$/, nodes.heading, (m) => ({ headingLevel: m[1].length })),
      blockRule(/^>\s$/, nodes.blockquote),
      blockRule(/^[-*+]\s$/, nodes.list_item, () => ({ listType: 'bullet' })),
      blockRule(/^\d+\.\s$/, nodes.list_item, () => ({ listType: 'number' })),
      blockRule(/^\[( |x)?\]\s$/, nodes.list_item, (m) => ({ listType: 'check', checked: m[1] === 'x' })),
      markRule(/(?:^|\s)(\*\*([^*]+)\*\*)$/, marks.strong),
      markRule(/(?:^|\s)(__([^_]+)__)$/, marks.strong),
      markRule(/(?:^|\s)(\*([^*]+)\*)$/, marks.em),
      markRule(/(?:^|\s)(_([^_]+)_)$/, marks.em),
      markRule(/(?:^|\s)(~~([^~]+)~~)$/, marks.strike),
      markRule(/(?:^|\s)(`([^`]+)`)$/, marks.code),
      autolinkRule(marks.link),
    ],
  });
}
