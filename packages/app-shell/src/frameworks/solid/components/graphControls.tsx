/**
 * The controls a node's action header may name — see `GraphHostBindings.nodeControls`.
 *
 * Lent to the graph by the host for the reason `nodeContent` is: these are the design system's own
 * primitives, and a graph package that named one would stop being portable. Each is a thin wrapper
 * that turns a primitive's event into the two callbacks the graph offers — `onPreview` while a
 * control is still moving, `onChange` when it has settled — and draws nothing outside its box.
 *
 * The values are the ones `recordStore.setCardStyle` takes, since that is what a template binds
 * `onNodeAction` to: a CSS colour or empty for none, a card shape name, a content scale.
 */
import type { NodeControl } from '@we/graph-solid';

/** A card's own colour, as a disc that opens the picker the rest of the app uses. */
export const ColorControl: NodeControl = (props) => (
  <we-color-picker
    tokens
    clearable
    // The fill the card is drawn in where it has no colour of its own — so the disc shows what the
    // card looks like rather than a blank. Picking Default emits '' and hands the choice back.
    value={typeof props.value === 'string' && props.value ? props.value : props.fill}
    styles={{ '--we-color-picker-swatch': '18px' }}
    on:change={(event: CustomEvent<string>) => props.onChange(event.detail)}
  />
);

const SHAPES = [
  { label: 'Note', value: 'note' },
  { label: 'Square', value: 'square' },
  { label: 'Round', value: 'round' },
];

/** The card's outline. */
export const ShapeControl: NodeControl = (props) => (
  <we-select
    size="xs"
    fit
    options={SHAPES}
    value={typeof props.value === 'string' && props.value ? props.value : 'note'}
    on:change={(event: CustomEvent<string>) => props.onChange(event.detail)}
  />
);

/** How large the card's content is drawn — previewing as it moves, writing on release. */
export const ScaleControl: NodeControl = (props) => (
  <we-slider
    size="xs"
    width="72px"
    min={0.5}
    max={2}
    step={0.1}
    value={typeof props.value === 'number' && props.value > 0 ? props.value : 1}
    on:input={(event: CustomEvent<number>) => props.onPreview(event.detail)}
    on:change={(event: CustomEvent<number>) => props.onChange(event.detail)}
  />
);

export const nodeControls = { color: ColorControl, shape: ShapeControl, scale: ScaleControl };
