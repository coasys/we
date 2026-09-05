/**
 * The floating selection toolbar: bold, italic, underline, strike, code, link. Appears above a
 * non-empty text selection; the link button (and Mod-K) turns it into a small URL prompt.
 */
import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import type { EditorContext } from '../context';
import { linkAtSelection, setLink } from './links';

const BUTTONS: Array<{ mark: string; icon: string; title: string }> = [
  { mark: 'strong', icon: 'text-b', title: 'Bold' },
  { mark: 'em', icon: 'text-italic', title: 'Italic' },
  { mark: 'underline', icon: 'text-underline', title: 'Underline' },
  { mark: 'strike', icon: 'text-strikethrough', title: 'Strikethrough' },
  { mark: 'code', icon: 'code', title: 'Code' },
];

function markActive(view: EditorView, type: MarkType): boolean {
  const { from, $from, to, empty } = view.state.selection;
  if (empty) return !!type.isInSet(view.state.storedMarks ?? $from.marks());
  return view.state.doc.rangeHasMark(from, to, type);
}

export function FormattingToolbar(props: {
  ctx: EditorContext;
  linkPrompt: () => boolean;
  setLinkPrompt: (v: boolean) => void;
}) {
  const [href, setHref] = createSignal('');
  let inputRef: HTMLInputElement | undefined;
  let toolbarRef: HTMLDivElement | undefined;

  const selection = createMemo(() => {
    props.ctx.version();
    const view = props.ctx.view();
    if (!view || !view.hasFocus()) return null;
    const { selection } = view.state;
    if (selection.empty || selection instanceof NodeSelection) return null;
    if (!selection.$from.parent.isTextblock) return null;
    return { from: selection.from, to: selection.to };
  });

  const visible = () => !!selection() || props.linkPrompt();

  const position = createMemo(() => {
    props.ctx.version();
    const view = props.ctx.view();
    if (!view || !visible()) return null;
    try {
      const from = view.state.selection.from;
      const to = view.state.selection.to;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      return { top: start.top - 44, left: Math.max(8, left) };
    } catch {
      return null;
    }
  });

  createEffect(() => {
    if (!visible() || !toolbarRef) return;
    toolbarRef.setAttribute('popover', 'manual');
    try {
      toolbarRef.showPopover();
    } catch {
      // Already shown
    }
    onCleanup(() => {
      try {
        toolbarRef?.hidePopover();
      } catch {
        // Already hidden
      }
    });
  });

  createEffect(() => {
    if (props.linkPrompt()) {
      const view = props.ctx.view();
      setHref((view && linkAtSelection(view)) ?? '');
      queueMicrotask(() => inputRef?.focus());
    }
  });

  function toggle(mark: string) {
    const view = props.ctx.view();
    if (!view) return;
    toggleMark(view.state.schema.marks[mark])(view.state, view.dispatch);
    view.focus();
  }

  function applyLink() {
    const view = props.ctx.view();
    if (!view) return;
    setLink(view, href());
    props.setLinkPrompt(false);
  }

  return (
    <Show when={visible() && position()}>
      <Portal>
        <div
          ref={toolbarRef}
          class="we-format-toolbar"
          role="toolbar"
          style={{ top: `${position()!.top}px`, left: `${position()!.left}px` }}
          onMouseDown={(e) => {
            // Keep the editor's selection: the toolbar acts on it.
            if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
          }}
        >
          <Show
            when={!props.linkPrompt()}
            fallback={
              <div class="we-format-toolbar-link">
                <input
                  ref={inputRef}
                  class="we-format-toolbar-input"
                  type="url"
                  placeholder="Paste a link…"
                  value={href()}
                  onInput={(e) => setHref(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyLink();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      props.setLinkPrompt(false);
                      props.ctx.view()?.focus();
                    }
                  }}
                />
                <button class="we-format-toolbar-button" title="Apply" onClick={applyLink}>
                  <we-icon name="check" size="xs" />
                </button>
                <button
                  class="we-format-toolbar-button"
                  title="Remove link"
                  onClick={() => {
                    setHref('');
                    applyLink();
                  }}
                >
                  <we-icon name="link-break" size="xs" />
                </button>
              </div>
            }
          >
            <For each={BUTTONS}>
              {(b) => (
                <button
                  class={`we-format-toolbar-button ${props.ctx.view() && markActive(props.ctx.view()!, props.ctx.view()!.state.schema.marks[b.mark]) ? 'we-format-toolbar-active' : ''}`}
                  title={b.title}
                  onClick={() => toggle(b.mark)}
                >
                  <we-icon name={b.icon} size="xs" />
                </button>
              )}
            </For>
            <button
              class={`we-format-toolbar-button ${props.ctx.view() && linkAtSelection(props.ctx.view()!) ? 'we-format-toolbar-active' : ''}`}
              title="Link"
              onClick={() => props.setLinkPrompt(true)}
            >
              <we-icon name="link" size="xs" />
            </button>
          </Show>
        </div>
      </Portal>
    </Show>
  );
}
