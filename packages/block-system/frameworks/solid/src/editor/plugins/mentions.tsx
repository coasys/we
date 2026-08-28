/**
 * @mentions: a typeahead that turns `@na` into a `mention` node for the person picked.
 *
 * The plugin owns the query — the `@…` run before the caret, recomputed on every transaction —
 * and decorates it so the stylesheet can show what is being matched. The menu is a Solid overlay
 * positioned at the query's start; keys the editor would otherwise consume (arrows, Enter, Tab,
 * Escape) are forwarded to it while it is open.
 *
 * Who can be mentioned comes from the host through `EditorContext.mentions`, so the composer
 * never reaches into a store; a template that wants a different roster passes one as a prop.
 */
import type { MentionCandidate } from '@we/block-shared';
import { type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import type { EditorContext } from '../context';
import { MENTION_NODE } from '../schema';

export interface MentionQuery {
  from: number;
  to: number;
  query: string;
}

export const mentionsKey = new PluginKey<MentionQuery | null>('we-mentions');

/** The key events the open menu answers. */
export interface MentionMenuController {
  move(delta: number): void;
  choose(): boolean;
  close(): void;
}

const controllers = new WeakMap<EditorView, MentionMenuController>();

/** The `@…` run ending at the caret, if the caret is in one. */
function queryAt(state: EditorState): MentionQuery | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 60), $from.parentOffset, undefined, '￼');
  const match = /(?:^|[\s(])@([^\s@￼]*)$/.exec(before);
  if (!match) return null;
  const query = match[1];
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

export function mentionsPlugin(): Plugin<MentionQuery | null> {
  return new Plugin<MentionQuery | null>({
    key: mentionsKey,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        if (tr.getMeta(mentionsKey) === 'close') return null;
        if (!tr.selectionSet && !tr.docChanged) return prev;
        // Recomputed from the new state — cheap, and the only correct answer after any edit.
        return queryAt(state);
      },
    },
    props: {
      decorations(state) {
        const q = mentionsKey.getState(state);
        if (!q) return null;
        return DecorationSet.create(state.doc, [Decoration.inline(q.from, q.to, { class: 'we-mention-query' })]);
      },
      handleKeyDown(view, event) {
        const q = mentionsKey.getState(view.state);
        if (!q) return false;
        const controller = controllers.get(view);
        if (!controller) return false;
        switch (event.key) {
          case 'ArrowDown':
            controller.move(1);
            return true;
          case 'ArrowUp':
            controller.move(-1);
            return true;
          case 'Enter':
          case 'Tab':
            return controller.choose();
          case 'Escape':
            controller.close();
            return true;
          default:
            return false;
        }
      },
    },
  });
}

/** Replace the query with a mention node for `candidate`, and a space after it. */
export function insertMention(view: EditorView, query: MentionQuery, candidate: MentionCandidate): void {
  const { schema } = view.state;
  const node = schema.nodes[MENTION_NODE].create({ did: candidate.did, text: `@${candidate.name}` });
  const tr = view.state.tr.replaceWith(query.from, query.to, node).insertText(' ');
  tr.setMeta(mentionsKey, 'close');
  view.dispatch(tr);
  view.focus();
}

const MAX_SHOWN = 8;

export function MentionMenu(props: { ctx: EditorContext }) {
  const [index, setIndex] = createSignal(0);

  const query = createMemo(() => {
    props.ctx.version();
    const view = props.ctx.view();
    return view ? (mentionsKey.getState(view.state) ?? null) : null;
  });

  const candidates = createMemo(() => {
    const q = query();
    if (!q) return [];
    const needle = q.query.toLowerCase();
    const all = props.ctx.mentions();
    const matching = needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all;
    return matching.slice(0, MAX_SHOWN);
  });

  const position = createMemo(() => {
    const q = query();
    const view = props.ctx.view();
    if (!q || !view) return null;
    try {
      const coords = view.coordsAtPos(q.from);
      return { top: coords.bottom + 4, left: coords.left };
    } catch {
      return null;
    }
  });

  createEffect(() => {
    candidates();
    setIndex(0);
  });

  createEffect(() => {
    const view = props.ctx.view();
    if (!view) return;
    const controller: MentionMenuController = {
      move: (delta) => {
        const n = candidates().length;
        if (!n) return;
        setIndex((i) => (i + delta + n) % n);
      },
      choose: () => {
        const q = query();
        const candidate = candidates()[index()];
        if (!q || !candidate) return false;
        insertMention(view, q, candidate);
        return true;
      },
      close: () => {
        view.dispatch(view.state.tr.setMeta(mentionsKey, 'close'));
      },
    };
    controllers.set(view, controller);
    onCleanup(() => controllers.delete(view));
  });

  let menuRef: HTMLDivElement | undefined;
  createEffect(() => {
    if (!query() || !menuRef) return;
    menuRef.setAttribute('popover', 'manual');
    try {
      menuRef.showPopover();
    } catch {
      // Already shown or popover API unavailable
    }
    onCleanup(() => {
      try {
        menuRef?.hidePopover();
      } catch {
        // Already hidden
      }
    });
  });

  const nothing = () => query() && candidates().length === 0;

  return (
    <Show when={query() && position()}>
      <Portal>
        <div
          ref={menuRef}
          class="we-mention-menu"
          role="listbox"
          style={{ top: `${position()!.top}px`, left: `${position()!.left}px` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Show when={!nothing()} fallback={<div class="we-mention-menu-empty">No one matches</div>}>
            <For each={candidates()}>
              {(candidate, i) => (
                <button
                  class={`we-mention-menu-item ${i() === index() ? 'we-mention-menu-focused' : ''}`}
                  role="option"
                  aria-selected={i() === index()}
                  onMouseEnter={() => setIndex(i())}
                  onClick={() => {
                    const view = props.ctx.view();
                    const q = query();
                    if (view && q) insertMention(view, q, candidate);
                  }}
                >
                  <we-avatar size="xs" image={candidate.avatar ?? ''} hash={candidate.did} initials={candidate.name} />
                  <we-text fontSize="200">{candidate.name}</we-text>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Portal>
    </Show>
  );
}
