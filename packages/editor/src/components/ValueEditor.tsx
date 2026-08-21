import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ScopeGroup } from '@we/schema-shared';
import { parseValue, parseValueIf, serializeValue, serializeValueIf } from '@we/schema-shared';
import { createMemo, createSignal, Match, Switch } from 'solid-js';

import { CodeViewer } from './CodeViewer';
import { ConditionEditor } from './ConditionEditor';
import { OperandInput } from './ValueRefPicker';

/**
 * Editor for any single value in a schema — a `children` entry or a value-producing prop.
 *
 * Picks the narrowest editor the token allows: a reference/literal picker for plain
 * values, a nested condition + two branches for the prop-level `$if`, and the raw JSON
 * editor for expressions with no direct equivalent ($concat, $map, $plural, $action).
 */

/** Depth cap for nested `$if` branches — past this the JSON editor is clearer. */
const MAX_VALUE_IF_DEPTH = 1;

export function ValueEditor(props: {
  value: unknown;
  scope: ScopeGroup[];
  onChange: (value: unknown) => void;
  /** Nesting level, incremented for the branches of a value-level `$if`. */
  depth?: number;
  placeholder?: string;
}) {
  const depth = () => props.depth ?? 0;

  /**
   * Set when the author asks to replace a custom expression with a picked value.
   * Without it the JSON editor is a one-way door: an expression the grammar can't
   * represent has no path back to a picker. Nothing is written until something is
   * picked, so the existing expression survives a change of mind.
   */
  const [replacing, setReplacing] = createSignal(false);

  const emit = (value: unknown) => {
    setReplacing(false);
    props.onChange(value);
  };

  const valueIf = createMemo(() => (replacing() || depth() >= MAX_VALUE_IF_DEPTH ? null : parseValueIf(props.value)));
  const operand = createMemo(() => (replacing() || valueIf() ? null : parseValue(props.value)));
  const mode = createMemo<'conditional' | 'operand' | 'replacing' | 'custom'>(() => {
    if (valueIf()) return 'conditional';
    if (operand()) return 'operand';
    return replacing() ? 'replacing' : 'custom';
  });

  return (
    <Switch>
      <Match when={mode() === 'operand'}>
        <OperandInput
          scope={props.scope}
          value={operand() ?? undefined}
          onChange={(next) => emit(serializeValue(next))}
          valueType="string"
          allowCount
          placeholder={props.placeholder}
        />
      </Match>

      {/* Replacing a custom expression — nothing is written until something is picked */}
      <Match when={mode() === 'replacing'}>
        <OperandInput
          scope={props.scope}
          onChange={(next) => emit(serializeValue(next))}
          valueType="string"
          allowCount
          placeholder={props.placeholder ?? 'Pick a replacement value'}
        />
      </Match>

      <Match when={mode() === 'custom'}>
        <Column gap="100">
          <Row ay="center" ax="between" gap="100">
            <Row ay="center" gap="100" minWidth="0">
              <we-icon name="info" size="xs" color="text-faint" />
              <we-text fontSize="100" color="text-faint" truncate>
                Custom expression — edit as JSON
              </we-text>
            </Row>
            <we-tooltip title="Pick a value from data">
              <we-button
                variant="ghost"
                size="xs"
                square
                onClick={() => setReplacing(true)}
                aria-label="Pick a value from data"
              >
                <we-icon name="database" size="xs" />
              </we-button>
            </we-tooltip>
          </Row>
          <Column border={`1px solid ${tokenVar('color', 'neutral-100')}`} r="200" overflow="hidden" maxHeight="250px">
            <CodeViewer json={JSON.stringify(props.value ?? null, null, 2)} onSave={(json) => emit(JSON.parse(json))} />
          </Column>
        </Column>
      </Match>

      <Match when={valueIf()}>
        {(branch) => (
          <Column gap="200" bg="surface-sunken" r="200" py="100">
            <ConditionEditor
              label="If"
              condition={branch().condition}
              scope={props.scope}
              onChange={(condition) => props.onChange(serializeValueIf({ ...branch(), condition }))}
            />
            <Column px="400" gap="200">
              <Column gap="100">
                <we-text fontSize="100" fontWeight="600" color="text-muted">
                  Then show
                </we-text>
                <ValueEditor
                  value={branch().then}
                  scope={props.scope}
                  depth={depth() + 1}
                  onChange={(then) => props.onChange(serializeValueIf({ ...branch(), then }))}
                  placeholder="Value when true"
                />
              </Column>
              <Column gap="100">
                <we-text fontSize="100" fontWeight="600" color="text-muted">
                  Otherwise show
                </we-text>
                <ValueEditor
                  value={branch().else ?? ''}
                  scope={props.scope}
                  depth={depth() + 1}
                  onChange={(otherwise) =>
                    props.onChange(
                      serializeValueIf({
                        condition: branch().condition,
                        then: branch().then,
                        // An empty branch means "render nothing" — drop the key rather than
                        // writing an empty string the renderer would print.
                        else: otherwise === '' ? undefined : otherwise,
                      }),
                    )
                  }
                  placeholder="Value when false"
                />
              </Column>
            </Column>
          </Column>
        )}
      </Match>
    </Switch>
  );
}
