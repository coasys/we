/**
 * Links: paste a URL over a selection to link it, paste one at the caret to insert it linked,
 * Mod-click a link to open it. Setting and clearing a link on the current selection is here too,
 * for the toolbar and the Mod-K prompt to call.
 */
import { safeHref } from '@we/design-utils';
import type { MarkType } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const URL_ONLY = /^(?:https?:\/\/|www\.)[^\s<>"']+$/i;

export function isUrl(text: string): boolean {
  return URL_ONLY.test(text.trim());
}

/**
 * The href to store, or `''` for one that would not be safe to click.
 *
 * Sanitised on the way in as well as on the way out. `toDOM` is the boundary that matters — it is
 * what renders a peer's mark — but storing a `javascript:` href and refusing to render it would
 * leave the document carrying something no reader can see and every future consumer must remember
 * to filter. Cheaper to never write it.
 */
function normalizeHref(text: string): string {
  const t = text.trim();
  return safeHref(t.startsWith('www.') ? `https://${t}` : t);
}

/**
 * Apply a link to the selection, or remove it with an empty href.
 *
 * An href `safeHref` refuses reads as an empty one — the link is removed rather than written with
 * nothing in it, so a `javascript:` URL typed into the Mod-K prompt leaves the text unlinked
 * instead of leaving an `<a>` that goes nowhere.
 */
export function setLink(view: EditorView, href: string): void {
  const { state } = view;
  const link: MarkType = state.schema.marks.link;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  const safe = normalizeHref(href);
  if (!safe) {
    if (empty) {
      // Remove the link around the caret.
      const range = linkRangeAt(view, from);
      if (range) tr.removeMark(range.from, range.to, link);
    } else tr.removeMark(from, to, link);
  } else if (empty) {
    const range = linkRangeAt(view, from);
    if (range) {
      tr.removeMark(range.from, range.to, link).addMark(range.from, range.to, link.create({ href: safe }));
    } else {
      const text = href.trim();
      tr.insertText(text, from, to).addMark(from, from + text.length, link.create({ href: safe }));
    }
  } else {
    tr.removeMark(from, to, link).addMark(from, to, link.create({ href: safe }));
  }
  tr.removeStoredMark(link);
  view.dispatch(tr);
  view.focus();
}

/** The link mark's href at the selection, if the caret or the whole selection is inside one. */
export function linkAtSelection(view: EditorView): string | null {
  const { state } = view;
  const link: MarkType = state.schema.marks.link;
  const { $from, empty, from, to } = state.selection;
  if (empty) {
    const mark = link.isInSet($from.marks());
    return mark ? String(mark.attrs.href) : null;
  }
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (href !== null || !node.isText) return;
    const mark = link.isInSet(node.marks);
    if (mark) href = String(mark.attrs.href);
  });
  return href;
}

/** The extent of the link mark around `pos`, if any. */
export function linkRangeAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const { doc, schema } = view.state;
  const $pos = doc.resolve(pos);
  const link = schema.marks.link;
  const mark = link.isInSet($pos.marks()) ?? ($pos.nodeAfter ? link.isInSet($pos.nodeAfter.marks) : undefined);
  if (!mark) return null;
  // The contiguous runs of inline children carrying this exact link (same href), then the one
  // that contains the position.
  const runs: Array<{ from: number; to: number }> = [];
  let offset = $pos.start();
  let from: number | null = null;
  let to = offset;
  $pos.parent.forEach((child) => {
    const has = child.isText && !!mark.isInSet(child.marks);
    if (has) {
      if (from === null) from = offset;
      to = offset + child.nodeSize;
    } else if (from !== null) {
      runs.push({ from, to });
      from = null;
    }
    offset += child.nodeSize;
  });
  if (from !== null) runs.push({ from, to });
  return runs.find((r) => r.from <= pos && pos <= r.to) ?? null;
}

export function linksPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (!isUrl(text)) return false;
        const html = event.clipboardData?.getData('text/html') ?? '';
        // Rich content that merely contains a URL is ProseMirror's to parse.
        if (html && !/^<a\b/i.test(html.trim()) && html.length > text.length + 200) return false;
        setLink(view, text.trim());
        return true;
      },
      handleClick(view, _pos, event) {
        const target = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!target || !(event.metaKey || event.ctrlKey)) return false;
        // The attribute, not `.href` — a refused link renders with an empty one, and the property
        // would resolve that against the current page and reopen the app in a new tab.
        const href = safeHref(target.getAttribute('href') ?? '');
        if (!href) return false;
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
  });
}
