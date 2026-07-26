import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ScopeGroup } from '@we/schema-shared';
import { parseValue, parseValueIf, serializeValue, serializeValueIf } from '@we/schema-shared';
import { createMemo, Show } from 'solid-js';

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

  const valueIf = createMemo(() => (depth() < MAX_VALUE_IF_DEPTH ? parseValueIf(props.value) : null));
  const operand = createMemo(() => (valueIf() ? null : parseValue(props.value)));

  return (
    <Show
      when={valueIf()}
      fallback={
        <Show
          when={operand()}
          fallback={
            <Column gap="100">
              <Row ay="center" gap="100">
                <we-icon name="info" size="xs" color="neutral-400" />
                <we-text fontSize="100" color="neutral-400">
                  Custom expression — edit as JSON
                </we-text>
              </Row>
              <Column
                border={`1px solid ${tokenVar('color', 'neutral-100')}`}
                r="200"
                overflow="hidden"
                styles={{ 'max-height': '250px' }}
              >
                <CodeViewer
                  json={JSON.stringify(props.value ?? null, null, 2)}
                  onSave={(json) => props.onChange(JSON.parse(json))}
                />
              </Column>
            </Column>
          }
        >
          {(value) => (
            <OperandInput
              scope={props.scope}
              value={value()}
              onChange={(next) => props.onChange(serializeValue(next))}
              valueType="string"
              allowCount
              placeholder={props.placeholder}
            />
          )}
        </Show>
      }
    >
      {(branch) => (
        <Column gap="200" bg="neutral-50" r="200" py="100">
          <ConditionEditor
            label="If"
            condition={branch().condition}
            scope={props.scope}
            onChange={(condition) => props.onChange(serializeValueIf({ ...branch(), condition }))}
          />
          <Column px="400" gap="200">
            <Column gap="100">
              <we-text fontSize="100" fontWeight="600" color="neutral-500">
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
              <we-text fontSize="100" fontWeight="600" color="neutral-500">
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
    </Show>
  );
}
