/**
 * Node views: how a custom block and a collection render inside the editor.
 *
 * A custom block's DOM is a `.we-block` wrapper that ProseMirror treats as an atom; inside it a
 * Solid root renders the block's registered **input** component, exactly as the old `BlockBridge`
 * did — with `onChange` writing a prop through a transaction (one undo step per change) and
 * `isSelected` a signal the toolbar shows on. `stopEvent` claims every event inside the wrapper,
 * so an input's keystrokes never reach the editor; `ignoreMutation` keeps the editor's DOM
 * observer out of Solid's business.
 *
 * ## Selecting a block that holds inputs
 *
 * Clicking the wrapper selects the block as a unit (a `NodeSelection`) and keeps the editor
 * focused — the caret model every block editor has. Clicking a *control* inside the block must do
 * the opposite: leave the editor's selection alone so the control keeps DOM focus. Those clicks
 * still mark the block active, through one document-level listener the composer owns rather than
 * one per block, which is what `EditorContext.activeDom` is.
 *
 * A collection is the one non-atom: its content DOM holds a nested composition the editor edits
 * directly, and its Solid root renders only the layout toolbar beside it.
 */
import type { CollectionContentBlock } from '@we/block-shared';
import { getBlockRegistration } from '@we/block-shared';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import type { Accessor, JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import type { EditorContext } from './context';
import { COLLECTION_NODE, collectionStyle, MENTION_NODE, UNKNOWN_NODE } from './schema';

/** Elements whose clicks belong to them, not to block selection. */
const INTERACTIVE =
  'input, textarea, select, button, a[href], [contenteditable="true"], .cm-editor, we-input, we-textarea, we-button, we-select, we-file-upload, we-checkbox, we-switch, we-slider, we-color-picker, we-date-picker, we-location-picker, we-icon-picker, we-number-input, we-modal, we-drawer, we-popover';

/** Whether an event started inside something that wants the click for itself. */
export function isInteractiveTarget(event: Event, within: HTMLElement): boolean {
  for (const el of event.composedPath()) {
    if (el === within) break;
    if (el instanceof Element && el.matches(INTERACTIVE)) return true;
  }
  return false;
}

type GetPos = () => number | undefined;

abstract class SolidNodeView implements NodeView {
  dom: HTMLElement;
  protected dispose?: () => void;
  protected setSelected: (v: boolean) => void;
  protected selected: Accessor<boolean>;

  constructor(
    protected node: PMNode,
    protected view: EditorView,
    protected getPos: GetPos,
    protected ctx: EditorContext,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'we-block';
    this.dom.setAttribute('data-block-type', node.type.name);
    const [selected, setSelected] = createSignal(false);
    this.selected = selected;
    this.setSelected = setSelected;
  }

  /** The block's own toolbar and any input show when it is selected as a node or holds an active control. */
  protected isSelected = (): boolean => this.selected() || this.ctx.activeDom() === this.dom;

  protected selectSelf(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos));
    this.view.dispatch(tr);
    this.view.focus();
  }

  selectNode(): void {
    this.setSelected(true);
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.setSelected(false);
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  destroy(): void {
    this.dispose?.();
  }
}

class CustomBlockView extends SolidNodeView {
  private props: Accessor<Record<string, unknown>>;
  private setProps: (p: Record<string, unknown>) => void;

  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: EditorContext) {
    super(node, view, getPos, ctx);
    const [props, setProps] = createSignal<Record<string, unknown>>(
      (node.attrs.props as Record<string, unknown>) ?? {},
    );
    this.props = props;
    this.setProps = setProps;

    this.dom.addEventListener('mousedown', (e) => {
      if (isInteractiveTarget(e, this.dom)) return; // the control keeps focus; the composer marks us active
      e.preventDefault();
      this.selectSelf();
    });

    const registration = getBlockRegistration(node.type.name);
    const Input = registration?.input as ((p: Record<string, unknown>) => JSX.Element) | undefined;
    this.dispose = render(
      () =>
        Input ? (
          <Input {...this.props()} onChange={this.onChange} isSelected={this.isSelected} />
        ) : (
          <div class="we-unknown-block">Unsupported block: {node.type.name}</div>
        ),
      this.dom,
    );
  }

  private onChange = (property: string, value: unknown): void => {
    const pos = this.getPos();
    if (pos === undefined) return;
    const current = this.view.state.doc.nodeAt(pos);
    if (!current) return;
    const props = { ...(current.attrs.props as Record<string, unknown>) };
    if (value === undefined) delete props[property];
    else props[property] = value;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, props }));
  };

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.setProps((node.attrs.props as Record<string, unknown>) ?? {});
    return true;
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

class CollectionView extends SolidNodeView {
  contentDOM: HTMLElement;
  private toolbarHost: HTMLElement;
  private layout: Accessor<Partial<CollectionContentBlock>>;
  private setLayout: (p: Partial<CollectionContentBlock>) => void;

  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: EditorContext) {
    super(node, view, getPos, ctx);
    this.dom.classList.add('we-collection-block');
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'we-collection-content we-block-content';
    this.toolbarHost = document.createElement('div');
    this.toolbarHost.className = 'we-collection-toolbar';
    this.toolbarHost.contentEditable = 'false';
    this.dom.append(this.contentDOM, this.toolbarHost);

    const [layout, setLayout] = createSignal<Partial<CollectionContentBlock>>(node.attrs.props ?? {});
    this.layout = layout;
    this.setLayout = setLayout;
    this.applyLayout(node);

    const registration = getBlockRegistration(COLLECTION_NODE);
    const Input = registration?.input as ((p: Record<string, unknown>) => JSX.Element) | undefined;
    this.dispose = render(
      () => (Input ? <Input {...this.layout()} onChange={this.onChange} isSelected={this.isSelectedOrInside} /> : null),
      this.toolbarHost,
    );
  }

  /** The toolbar shows when the collection is selected as a unit or the caret is inside it. */
  private isSelectedOrInside = (): boolean => {
    if (this.isSelected()) return true;
    this.ctx.version();
    const pos = this.getPos();
    if (pos === undefined) return false;
    const { from } = this.view.state.selection;
    return from > pos && from < pos + this.node.nodeSize;
  };

  private onChange = (property: string, value: unknown): void => {
    const pos = this.getPos();
    if (pos === undefined) return;
    const current = this.view.state.doc.nodeAt(pos);
    if (!current) return;
    const props = { ...(current.attrs.props as Record<string, unknown>), [property]: value };
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, props }));
  };

  private applyLayout(node: PMNode): void {
    const props = (node.attrs.props ?? {}) as Partial<CollectionContentBlock>;
    this.dom.setAttribute('data-layout', String(props.layout ?? 'grid'));
    this.dom.setAttribute('style', collectionStyle(props));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.applyLayout(node);
    this.setLayout(node.attrs.props ?? {});
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.toolbarHost.contains(event.target as Node);
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}

/** Node views: the collection, and every custom block type named. */
export function nodeViewsFor(
  customNodeNames: readonly string[],
  ctx: EditorContext,
): Record<string, NodeViewConstructor> {
  const views: Record<string, NodeViewConstructor> = {
    [COLLECTION_NODE]: (node, view, getPos) => new CollectionView(node, view, getPos, ctx),
  };
  for (const name of customNodeNames) {
    if (name === MENTION_NODE || name === UNKNOWN_NODE) continue;
    views[name] = (node, view, getPos) => new CustomBlockView(node, view, getPos, ctx);
  }
  return views;
}
