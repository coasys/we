import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

/** The controls a field can hold, and how each reports a new value. */
const CONTROLS = {
  input: { tag: 'we-input', event: 'onInput', value: { $: 'event.detail' } },
  textarea: { tag: 'we-textarea', event: 'onInput', value: { $: 'event.detail' } },
  select: { tag: 'we-select', event: 'onChange', value: { $: 'event.detail' } },
} as const;

export interface FieldOptions {
  /** The `$localState` field this reads and writes. An ancestor must declare it. */
  name: string;
  label?: string;
  /** The line under the label, for a field whose name is not self-explanatory. */
  description?: string;
  control?: keyof typeof CONTROLS;
  placeholder?: string;
  /** Extra props for the control itself — `options` for a select, `rows` for a textarea, `type`. */
  props?: Record<string, SchemaProp>;
  /**
   * Surface this field's validation error.
   *
   * `error()` is already empty until the field is touched, so this needs no condition around it —
   * several call sites wrapped it in a `$if` testing the same token it was about to render.
   */
  validated?: boolean;
  /**
   * Mark the field touched when it is left.
   *
   * An opt-in, not boilerplate. It earns its place on a long form where a field is worth judging the
   * moment it is left — a `match` rule on a confirm-password, say. On a short form it fires an error
   * at somebody who merely clicked through a field they had not filled in yet.
   */
  touchOnBlur?: boolean;
  disabled?: SchemaProp;
  /** Actions to run after the value is stored — a dirty flag, usually. */
  also?: SchemaProp[];
  /** What to do when the field is left — an autosave, usually. */
  onBlur?: SchemaProp;
}

/**
 * A labelled control bound to one field of local state.
 *
 * Forty-two of these across the two template packages, each spelling out the same triple: read
 * `$local`, write `$setLocal` on the control's own event, and pass the field's error to the wrapper.
 *
 * ## Why this is a fragment and not a `$field` operator
 *
 * A schema-level shorthand was the obvious move — the boilerplate is `value`/`onInput`/`$setLocal`,
 * which is schema machinery rather than a UI shape. It is the wrong move, because the mapping from
 * a field to *how a control reports a change* is per-component knowledge: `we-input` emits
 * `onInput` with `$event.detail`, `we-select` emits `onChange`, `Search` calls back with the value
 * itself as `$arg`. An operator would have to either hold a table of component conventions — putting
 * design-system knowledge inside the schema resolver, which is exactly what the layering forbids —
 * or be told the event and the path at each call site, at which point it saves nothing over writing
 * the two props.
 *
 * A fragment can hold that table, because it lives in the layer that already knows the components.
 */
export function field(opts: FieldOptions): SchemaNode {
  const control = CONTROLS[opts.control ?? 'input'];

  const setValue = { $setLocal: opts.name, value: control.value };

  return {
    type: 'we-form-field',
    props: {
      ...(opts.label && { label: opts.label }),
      ...(opts.description && { description: opts.description }),
      ...(opts.validated && { error: expr`error(${opts.name})` }),
    },
    children: [
      {
        type: control.tag,
        props: {
          ...(opts.placeholder && { placeholder: opts.placeholder }),
          value: { $: `local.${opts.name}` },
          ...(opts.disabled !== undefined && { disabled: opts.disabled }),
          [control.event]: opts.also?.length ? [setValue, ...opts.also] : setValue,
          ...(opts.touchOnBlur || opts.onBlur
            ? {
                onBlur: opts.touchOnBlur
                  ? opts.onBlur
                    ? [{ $touch: opts.name }, opts.onBlur]
                    : { $touch: opts.name }
                  : opts.onBlur,
              }
            : {}),
          ...opts.props,
        },
      },
    ],
  };
}
