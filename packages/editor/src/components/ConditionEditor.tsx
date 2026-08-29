import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ComparisonOperator, ConditionExpr, ConditionOperand, ScopeGroup } from '@we/schema-shared';
import { isUnaryOperator, parseCondition, serializeCondition } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';

import { exprComplete, operandValueType } from '../helpers';
import { CodeViewer } from './CodeViewer';
import { OperandInput } from './ValueRefPicker';

/**
 * Row-based editor for a condition token ($if conditions today; `disabled`/`hidden`
 * style props next).
 *
 * Conditions the grammar can't represent exactly fall back to the JSON editor rather
 * than being approximated — see `conditionRecord.ts`. The JSON editor is also always
 * reachable from the toggle, so the builder never becomes a ceiling.
 */

const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  truthy: 'is set / true',
  falsy: 'is not set / false',
  eq: 'equals',
  ne: 'does not equal',
  gt: 'is greater than',
  lt: 'is less than',
  in: 'is one of',
  nin: 'is not one of',
};

const OPERATOR_OPTIONS = (Object.keys(OPERATOR_LABELS) as ComparisonOperator[]).map((value) => ({
  label: OPERATOR_LABELS[value],
  value,
}));

/** A reference with no path chosen yet, or an unfilled literal, isn't ready to emit. */

function emptyRow(): ConditionExpr {
  return { type: 'comparison', operator: 'truthy', left: { kind: 'context', path: '' } };
}

export function ConditionEditor(props: {
  condition: unknown;
  scope: ScopeGroup[];
  onChange: (token: unknown) => void;
  /** Label above the editor — e.g. "Show when". */
  label?: string;
}) {
  const [draft, setDraft] = createSignal<ConditionExpr | null>(parseCondition(props.condition));
  const [rawMode, setRawMode] = createSignal(false);

  // Adopt external edits (undo/redo, AI changes, selecting another node) but ignore the
  // echo of our own writes, which would otherwise clobber an in-progress row.
  createEffect(() => {
    const incoming = props.condition;
    const current = untrack(draft);
    if (current && JSON.stringify(serializeCondition(current)) === JSON.stringify(incoming)) return;
    setDraft(parseCondition(incoming));
  });

  /** True when a condition exists but the builder can't represent it exactly. */
  const unsupported = createMemo(() => props.condition !== undefined && parseCondition(props.condition) === null);

  const update = (next: ConditionExpr) => {
    setDraft(next);
    if (exprComplete(next)) props.onChange(serializeCondition(next));
  };

  const rows = createMemo<ConditionExpr[]>(() => {
    const expr = draft();
    if (!expr) return [];
    return expr.type === 'group' ? expr.children : [expr];
  });

  const groupOperator = () => {
    const expr = draft();
    return expr?.type === 'group' ? expr.operator : 'and';
  };

  const replaceRow = (index: number, next: ConditionExpr | null) => {
    const expr = draft();
    if (!expr) return;
    if (expr.type !== 'group') {
      if (next) update(next);
      else {
        setDraft(null);
        props.onChange(null);
      }
      return;
    }
    const children = [...expr.children];
    if (next) children[index] = next;
    else children.splice(index, 1);

    if (children.length === 0) {
      setDraft(null);
      props.onChange(null);
      return;
    }
    // Collapse a one-child group back to a bare comparison so the token stays idiomatic.
    update(children.length === 1 ? children[0] : { ...expr, children });
  };

  const addRow = () => {
    const expr = draft();
    const next = emptyRow();
    if (!expr) {
      setDraft(next);
      return;
    }
    if (expr.type === 'group') setDraft({ ...expr, children: [...expr.children, next] });
    else setDraft({ type: 'group', operator: 'and', children: [expr, next] });
  };

  const setGroupOperator = (operator: 'and' | 'or') => {
    const expr = draft();
    if (expr?.type !== 'group') return;
    update({ ...expr, operator });
  };

  return (
    <Column gap="200" px="400" py="200">
      <Row ay="center" ax="between" gap="200">
        <we-text fontSize="100" fontWeight="600" textTransform="uppercase" letterSpacing="0.06em" color="text-faint">
          {props.label ?? 'Condition'}
        </we-text>
        <Show when={!unsupported()}>
          <we-tooltip title={rawMode() ? 'Back to the builder' : 'Edit as JSON'}>
            <we-button variant="ghost" size="xs" square onClick={() => setRawMode((v) => !v)} aria-label="Edit as JSON">
              <we-icon name={rawMode() ? 'sliders-horizontal' : 'code'} size="xs" />
            </we-button>
          </we-tooltip>
        </Show>
      </Row>

      <Show
        when={!rawMode() && !unsupported()}
        fallback={
          <Column gap="100">
            <Show when={unsupported()}>
              <Row ay="center" gap="100">
                <we-icon name="info" size="xs" color="text-faint" />
                <we-text fontSize="100" color="text-faint">
                  Custom expression — edit as JSON
                </we-text>
              </Row>
            </Show>
            <Column
              border={`1px solid ${tokenVar('color', 'neutral-100')}`}
              r="200"
              overflow="hidden"
              maxHeight="250px"
            >
              <CodeViewer
                json={JSON.stringify(props.condition ?? null, null, 2)}
                onSave={(json) => props.onChange(JSON.parse(json))}
              />
            </Column>
          </Column>
        }
      >
        <Column gap="200">
          <Show when={rows().length > 1}>
            <Row ay="center" gap="200">
              <we-text fontSize="200" color="text-muted">
                Match
              </we-text>
              <we-select
                size="xs"
                width="90px"
                value={groupOperator()}
                options={[
                  { label: 'all', value: 'and' },
                  { label: 'any', value: 'or' },
                ]}
                on:change={(e: CustomEvent) => setGroupOperator(e.detail === 'or' ? 'or' : 'and')}
              />
              <we-text fontSize="200" color="text-muted">
                of these
              </we-text>
            </Row>
          </Show>

          <For each={rows()}>
            {(row, index) => (
              <ConditionRow
                expr={row}
                scope={props.scope}
                onChange={(next) => replaceRow(index(), next)}
                onRemove={() => replaceRow(index(), null)}
                removable={rows().length > 1 || draft() !== null}
              />
            )}
          </For>

          <Row>
            <we-button variant="ghost" size="xs" onClick={addRow}>
              <we-icon name="plus" size="xs" />
              {rows().length === 0 ? 'Add condition' : 'Add another'}
            </we-button>
          </Row>
        </Column>
      </Show>
    </Column>
  );
}

/**
 * A single comparison row. Nested groups render read-only here — the builder edits one
 * level of grouping; anything deeper stays in JSON (see MAX_CONDITION_DEPTH).
 */
function ConditionRow(props: {
  expr: ConditionExpr;
  scope: ScopeGroup[];
  onChange: (next: ConditionExpr) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const comparison = () => (props.expr.type === 'comparison' ? props.expr : null);

  // Type the literal side from whichever side holds a known reference.
  const literalType = () => {
    const cmp = comparison();
    if (!cmp) return 'unknown' as const;
    const left = operandValueType(cmp.left, props.scope);
    return left === 'unknown' ? operandValueType(cmp.right, props.scope) : left;
  };

  const setOperator = (operator: ComparisonOperator) => {
    const cmp = comparison();
    if (!cmp) return;
    if (isUnaryOperator(operator)) {
      props.onChange({ type: 'comparison', operator, left: cmp.left });
      return;
    }
    // `is one of` takes a list; every other binary operator takes a single value.
    const right =
      operator === 'in' || operator === 'nin'
        ? cmp.right?.kind === 'list'
          ? cmp.right
          : ({ kind: 'list', value: [] } as ConditionOperand)
        : (cmp.right ?? ({ kind: 'literal', value: '' } as ConditionOperand));
    props.onChange({ type: 'comparison', operator, left: cmp.left, right });
  };

  return (
    <Show
      when={comparison()}
      fallback={
        <Row ay="center" gap="200" px="200" py="100" bg="surface-sunken" r="200">
          <we-icon name="brackets-curly" size="xs" color="text-faint" />
          <we-text flex="1" fontSize="200" color="text-muted" truncate>
            Grouped condition — edit as JSON
          </we-text>
        </Row>
      }
    >
      {(cmp) => (
        <Column gap="100" p="200" bg="surface-sunken" r="200">
          <Row ay="center" gap="100">
            <Column flex="1" minWidth="0">
              {/* No text entry on the left: this side names what is being tested, and a
                  literal here makes the condition constant. The right side is where a
                  fixed value belongs — that's what you're comparing against. */}
              <OperandInput
                scope={props.scope}
                value={cmp().left}
                onChange={(left) => props.onChange({ ...cmp(), left })}
                valueType={operandValueType(cmp().right, props.scope)}
                allowCount
                allowText={false}
                placeholder="Select a value"
              />
            </Column>
            <Show when={props.removable}>
              <we-tooltip title="Remove this condition">
                <we-button variant="ghost" size="xs" square onClick={props.onRemove} aria-label="Remove condition">
                  <we-icon name="x" size="xs" />
                </we-button>
              </we-tooltip>
            </Show>
          </Row>

          <we-select
            size="xs"
            value={cmp().operator}
            options={OPERATOR_OPTIONS}
            on:change={(e: CustomEvent) => setOperator(e.detail as ComparisonOperator)}
          />

          <Show when={!isUnaryOperator(cmp().operator)}>
            <OperandInput
              scope={props.scope}
              value={cmp().right}
              onChange={(right) => props.onChange({ ...cmp(), right })}
              valueType={literalType()}
              list={cmp().operator === 'in' || cmp().operator === 'nin'}
              allowCount
              placeholder="Value"
            />
          </Show>
        </Column>
      )}
    </Show>
  );
}
