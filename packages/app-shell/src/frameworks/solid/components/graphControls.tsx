/**
 * The controls a node's action header may name — see `GraphHostBindings.nodeControls`.
 *
 * Lent to the graph by the host for the reason `nodeContent` is: these are the design system's own
 * primitives, and a graph package that named one would stop being portable. Each is a thin wrapper
 * that turns a primitive's event into the two callbacks the graph offers — `onPreview` while a
 * control is still moving, `onChange` when it has settled — and draws nothing outside its box.
 *
 * ## One square each, and the rest behind it
 *
 * The header is a bar of squares, and a control gets one. What needs more room than a square — a
 * row of shapes, a slider — opens under the bar from a trigger, the way the colour picker's own
 * popover opens from its swatch. `we-graph__control-trigger` and `we-graph__control-popup` are the
 * two classes the graph names for exactly this, so the square and the popup take the bar's own
 * styling and stay in step with the buttons beside them.
 *
 * The values are the ones `recordStore.setCardStyle` takes, since that is what a template binds
 * `onNodeAction` to: a CSS colour or empty for none, a card shape name, a content scale.
 */
import type { NodeControl } from '@we/graph-solid';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

/**
 * A square trigger and the popup it opens — closed by a press anywhere else.
 *
 * The listener is on the document in the capture phase, because the header stops a press from
 * reaching the canvas beneath it — which is right for the card and would otherwise mean a popup
 * that only ever closed from inside itself.
 */
function Popup(props: { icon: string; title?: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  let box: HTMLDivElement | undefined;

  const onPressOutside = (event: PointerEvent) => {
    if (open() && box && !box.contains(event.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onPressOutside, true);
  onCleanup(() => document.removeEventListener('pointerdown', onPressOutside, true));

  return (
    <div ref={box} style={{ display: 'contents' }}>
      <button
        type="button"
        class="we-graph__control-trigger"
        title={props.title}
        aria-label={props.title}
        aria-expanded={open() ? 'true' : 'false'}
        onClick={() => setOpen((value) => !value)}
      >
        <we-icon name={props.icon} size="18px" />
      </button>
      <Show when={open()}>
        <div class="we-graph__control-popup">{props.children}</div>
      </Show>
    </div>
  );
}

/** A card's own colour: the picker's swatch, at the square's size, opening the picker itself. */
export const ColorControl: NodeControl = (props) => (
  <we-color-picker
    tokens
    clearable
    // The fill the card is drawn in where it has no colour of its own — so the swatch shows what the
    // card looks like rather than a blank. Picking Default emits '' and hands the choice back.
    value={typeof props.value === 'string' && props.value ? props.value : props.fill}
    styles={{ '--we-color-picker-swatch': '24px' }}
    on:change={(event: CustomEvent<string>) => props.onChange(event.detail)}
  />
);

const SHAPES = [
  { label: 'Note', value: 'note', icon: 'note' },
  { label: 'Square', value: 'square', icon: 'square' },
  { label: 'Round', value: 'round', icon: 'circle' },
];

/** The card's outline: a shapes glyph opening the three to choose from. */
export const ShapeControl: NodeControl = (props) => {
  const current = () => (typeof props.value === 'string' && props.value ? props.value : 'note');
  return (
    <Popup icon="shapes" title={props.title}>
      <For each={SHAPES}>
        {(shape) => (
          <we-button
            size="sm"
            square
            variant={current() === shape.value ? 'secondary' : 'ghost'}
            label={shape.label}
            onClick={() => props.onChange(shape.value)}
          >
            <we-icon name={shape.icon} />
          </we-button>
        )}
      </For>
    </Popup>
  );
};

/** How large the card's content is drawn: a slider, previewing as it moves and writing on release. */
export const ScaleControl: NodeControl = (props) => {
  const current = () => (typeof props.value === 'number' && props.value > 0 ? props.value : 1);
  return (
    <Popup icon="text-aa" title={props.title}>
      <we-slider
        size="sm"
        width="120px"
        min={0.5}
        max={2}
        step={0.1}
        value={current()}
        on:input={(event: CustomEvent<number>) => props.onPreview(event.detail)}
        on:change={(event: CustomEvent<number>) => props.onChange(event.detail)}
      />
      <we-text variant="footnote" color="text-muted">
        {Math.round(current() * 100)}%
      </we-text>
    </Popup>
  );
};

export const nodeControls = { color: ColorControl, shape: ShapeControl, scale: ScaleControl };
