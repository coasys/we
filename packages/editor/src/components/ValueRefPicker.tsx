import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ConditionOperand, ScopeGroup, ScopeRef, ScopeValueType } from '@we/schema-shared';
import { inferRefKind } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';

import { operandLabel, refPath, refToOperand } from '../helpers';

/**
 * Pickers for a single value in the logic editors.
 *
 * `ValueRefPicker` is the grouped, searchable list of everything in scope at a node
 * (iteration variables, page state, store members, context refs). `OperandInput` wraps it
 * with a literal-value mode so one control can express both "compare against this data"
 * and "compare against this fixed value".
 */

// ── Display helpers ─────────────────────────────────────────────────────────

const KIND_ICONS: Record<ScopeRef['kind'], string> = {
  item: 'list',
  local: 'note',
  store: 'database',
  context: 'globe',
};

function operandIcon(operand: ConditionOperand | undefined): string {
  if (!operand) return 'plus';
  if (operand.kind === 'literal' || operand.kind === 'list') return 'text-aa';
  if (operand.kind === 'count') return 'hash';
  if (operand.kind === 'formState') return 'check-circle';
  return KIND_ICONS[operand.kind];
}

// ── ValueRefPicker ──────────────────────────────────────────────────────────

export function ValueRefPicker(props: {
  scope: ScopeGroup[];
  value?: ConditionOperand;
  onSelect: (operand: ConditionOperand) => void;
  /** Offer a "count of a list" entry that wraps a reference in $count. */
  allowCount?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  let ref!: HTMLDivElement;

  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (!ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  const filtered = createMemo<ScopeGroup[]>(() => {
    const term = search().trim().toLowerCase();
    if (!term) return props.scope;
    return props.scope
      .map((group) => ({
        ...group,
        refs: group.refs.filter((r) => r.path.toLowerCase().includes(term) || group.label.toLowerCase().includes(term)),
      }))
      .filter((group) => group.refs.length > 0);
  });

  /**
   * The typed text as a reference, when it resolves to a known store/local/context root
   * and isn't already offered in the list. Lets an author reach a property the registry
   * doesn't describe without dropping to the JSON editor.
   */
  const customPath = createMemo<{ kind: 'store' | 'local' | 'context'; path: string } | null>(() => {
    const path = search().trim();
    if (!path) return null;
    if (props.scope.some((g) => g.refs.some((r) => r.path === path))) return null;
    const kind = inferRefKind(path, props.scope);
    return kind && kind !== 'item' ? { kind, path } : null;
  });

  const choose = (operand: ConditionOperand) => {
    props.onSelect(operand);
    setOpen(false);
    setSearch('');
  };

  const label = () => operandLabel(props.value) || (props.placeholder ?? 'Select a value');

  return (
    <div ref={ref} style={{ position: 'relative', 'min-width': '0' }}>
      <we-button variant="outline" size="xs" width="100%" onClick={() => setOpen((v) => !v)}>
        <Row ay="center" gap="200" width="100%" minWidth="0">
          <we-icon name={operandIcon(props.value)} size="xs" color="text-faint" />
          <we-text flex="1" truncate fontSize="200" color={props.value ? 'neutral-800' : 'neutral-400'}>
            {label()}
          </we-text>
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size="xs" color="text-faint" />
        </Row>
      </we-button>

      <Show when={open()}>
        <Column position="absolute" zIndex={600} top="100%" left="0" mt="3px" minWidth="240px" maxWidth="320px">
          <we-menu>
            <Column p="200" gap="200" maxHeight="320px">
              <we-input
                type="text"
                size="xs"
                autofocus
                placeholder="Search or type a path…"
                value={search()}
                on:input={(e: CustomEvent<string>) => setSearch(e.detail)}
              />

              {/* The registry describes stores by hand and so is never quite complete.
                  Rather than dead-ending on a path it doesn't list, offer the typed one —
                  but only when its first segment resolves to a known store, local field or
                  context ref, so an unresolvable path can't be created by typo. */}
              <Show when={customPath()}>
                {(custom) => (
                  <we-menu-item on:select={() => choose(custom())}>
                    <Row ay="center" gap="200" minWidth="0">
                      <we-icon name="arrow-elbow-down-right" size="xs" color="text-faint" />
                      <we-text fontSize="200" truncate>
                        Use “{custom().path}”
                      </we-text>
                    </Row>
                  </we-menu-item>
                )}
              </Show>

              <we-scroll-area maxHeight="240px">
                <Column gap="100">
                  <For each={filtered()}>
                    {(group) => (
                      <Column gap="0">
                        <we-text
                          px="200"
                          py="100"
                          fontSize="100"
                          fontWeight="600"
                          textTransform="uppercase"
                          letterSpacing="0.06em"
                          color="text-faint"
                        >
                          {group.label}
                        </we-text>
                        <For each={group.refs}>
                          {(scopeRef) => (
                            <we-menu-item
                              selected={refPath(props.value) === scopeRef.path}
                              on:select={() => choose(refToOperand(scopeRef))}
                            >
                              <Row ay="center" gap="200" minWidth="0">
                                <we-icon name={KIND_ICONS[scopeRef.kind]} size="xs" color="text-faint" />
                                <we-text fontSize="200" truncate>
                                  {scopeRef.label}
                                </we-text>
                                <Show when={scopeRef.valueType !== 'unknown'}>
                                  <we-text fontSize="100" color="text-faint">
                                    {scopeRef.valueType}
                                  </we-text>
                                </Show>
                              </Row>
                            </we-menu-item>
                          )}
                        </For>
                      </Column>
                    )}
                  </For>

                  <Show when={filtered().length === 0}>
                    <we-text px="200" py="200" fontSize="200" color="text-faint">
                      Nothing in scope matches.
                    </we-text>
                  </Show>
                </Column>
              </we-scroll-area>

              <Show when={props.allowCount}>
                <Column borderTop={`1px solid ${tokenVar('color', 'neutral-100')}`} pt="100">
                  <we-menu-item on:select={() => choose({ kind: 'count', items: { kind: 'context', path: '' } })}>
                    <Row ay="center" gap="200">
                      <we-icon name="hash" size="xs" color="text-faint" />
                      <we-text fontSize="200">Count of a list…</we-text>
                    </Row>
                  </we-menu-item>
                </Column>
              </Show>
            </Column>
          </we-menu>
        </Column>
      </Show>
    </div>
  );
}

// ── OperandInput ────────────────────────────────────────────────────────────

/**
 * One side of a comparison: either a reference picked from scope, or a literal typed
 * inline. The literal control is typed by `valueType` — which the caller derives from
 * the *other* side, so comparing a boolean store member offers true/false rather than
 * free text.
 */
export function OperandInput(props: {
  scope: ScopeGroup[];
  value?: ConditionOperand;
  onChange: (operand: ConditionOperand) => void;
  valueType?: ScopeValueType;
  /** Accept a comma-separated list — used for the `is one of` operator. */
  list?: boolean;
  /** Offer wrapping a reference in `$count`. */
  allowCount?: boolean;
  /**
   * Offer plain-text entry. False for the left side of a comparison, where a literal
   * makes a constant condition — across the built-in templates the left operand is a
   * reference 1823 times and a literal 10, while the right is a literal 965 times.
   */
  allowText?: boolean;
  placeholder?: string;
}) {
  /**
   * Which editor to show is UI state, not something derivable from the value.
   *
   * Half-made choices have no valid serialized form: an empty reference writes `''`,
   * which reads back as an empty *literal*, and `{ $count: { items: '' } }` reads back as
   * a count over an empty literal. Callers that write through on every change (ValueEditor
   * does) would bounce straight out of the mode that was just asked for — which is exactly
   * how the switch buttons ended up doing nothing and how a new count landed in raw JSON.
   *
   * Holding the intent here means nothing is written until the choice is complete, so the
   * node keeps its current value while a mode is being explored.
   */
  const [refMode, setRefMode] = createSignal(false);
  const [textMode, setTextMode] = createSignal(false);
  const [pendingCount, setPendingCount] = createSignal<Extract<ConditionOperand, { kind: 'count' }> | null>(null);

  /** A reference is only usable once it actually points somewhere. */
  const isResolved = (operand: ConditionOperand | undefined): boolean =>
    !!operand && (operand.kind === 'store' || operand.kind === 'local' || operand.kind === 'context')
      ? (operand as { path: string }).path.trim() !== ''
      : false;

  const clearOverrides = () => {
    setRefMode(false);
    setTextMode(false);
    setPendingCount(null);
  };

  const pick = (operand: ConditionOperand) => {
    if (operand.kind === 'count' && !isResolved(operand.items)) {
      setRefMode(false);
      setTextMode(false);
      setPendingCount(operand);
      return;
    }
    clearOverrides();
    props.onChange(operand);
  };

  const literalControl = () => {
    if (props.list) {
      const current = props.value?.kind === 'list' ? props.value.value.join(', ') : '';
      return (
        <we-input
          type="text"
          size="xs"
          flex="1"
          value={current}
          placeholder="admin, moderator"
          on:change={(e: CustomEvent<string>) =>
            props.onChange({
              kind: 'list',
              value: e.detail
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      );
    }

    const literal = props.value?.kind === 'literal' ? props.value.value : '';

    if (props.valueType === 'boolean') {
      return (
        <we-select
          flex="1"
          size="xs"
          value={String(literal === true)}
          options={[
            { label: 'true', value: 'true' },
            { label: 'false', value: 'false' },
          ]}
          on:change={(e: CustomEvent) => props.onChange({ kind: 'literal', value: e.detail === 'true' })}
        />
      );
    }

    if (props.valueType === 'number') {
      return (
        <we-input
          type="number"
          size="xs"
          flex="1"
          value={literal === null ? '' : String(literal)}
          on:change={(e: CustomEvent<string>) => {
            const parsed = Number(e.detail);
            props.onChange({ kind: 'literal', value: isNaN(parsed) ? e.detail : parsed });
          }}
        />
      );
    }

    return (
      <we-input
        type="text"
        size="xs"
        flex="1"
        value={literal === null ? '' : String(literal)}
        placeholder={props.placeholder ?? 'Value'}
        on:change={(e: CustomEvent<string>) => props.onChange({ kind: 'literal', value: e.detail })}
      />
    );
  };

  /**
   * The two ways to express a value, always both offered. Data opens the picker (whose
   * footer also reaches list counts); Text goes straight to plain entry. Two orthogonal
   * one-click affordances rather than routing text entry through the picker, so no mode
   * is ever more than a click from either.
   *
   * Neither writes anything: the current value stands until something is picked or typed,
   * so changing your mind costs nothing.
   */
  const modeButtons = () => (
    <Row gap="0" flex="none">
      <Show when={props.allowText !== false}>
        <we-tooltip title="Use a fixed value">
          <we-button
            variant={mode() === 'literal' ? 'secondary' : 'ghost'}
            size="xs"
            square
            onClick={() => {
              setRefMode(false);
              setPendingCount(null);
              setTextMode(true);
            }}
            aria-label="Use a fixed value"
          >
            <we-icon name="text-aa" size="xs" />
          </we-button>
        </we-tooltip>
      </Show>
      <we-tooltip title="Pick a value from data">
        <we-button
          variant={mode() === 'literal' ? 'ghost' : 'secondary'}
          size="xs"
          square
          onClick={() => {
            setTextMode(false);
            setPendingCount(null);
            setRefMode(true);
          }}
          aria-label="Pick a value from data"
        >
          <we-icon name="database" size="xs" />
        </we-button>
      </we-tooltip>
    </Row>
  );

  // `$count` wraps another reference, so it renders as a labelled row containing a
  // nested picker rather than as a leaf control. A pending count (list not yet chosen)
  // renders the same way, so the row appears the moment it is asked for.
  const countValue = () => pendingCount() ?? (props.value?.kind === 'count' ? props.value : null);

  // Validation-state readers name a field from the surrounding $localState, which is
  // exactly the `local` group of the scope — so the field list comes for free.
  const formStateValue = () => (props.value?.kind === 'formState' ? props.value : null);
  const localFieldOptions = () => {
    const fields = props.scope.filter((g) => g.kind === 'local').flatMap((g) => g.refs.map((r) => r.path));
    return [{ label: 'the whole form', value: '$scope' }, ...fields.map((f) => ({ label: f, value: f }))];
  };

  const mode = createMemo<'literal' | 'composite' | 'picker'>(() => {
    if (textMode()) return 'literal';
    if (refMode()) return 'picker';
    if (countValue() || formStateValue()) return 'composite';
    if (props.value?.kind === 'literal' || props.value?.kind === 'list') return 'literal';
    return 'picker';
  });

  return (
    <Row ay="center" gap="100" minWidth="0">
      <Column flex="1" minWidth="0">
        <Switch>
          <Match when={mode() === 'literal'}>{literalControl()}</Match>

          <Match when={mode() === 'composite'}>
            <Row ay="center" gap="100" minWidth="0">
              <Show when={countValue()}>
                {(count) => (
                  <>
                    <we-text fontSize="200" color="text-muted" whiteSpace="nowrap">
                      count of
                    </we-text>
                    <Column flex="1" minWidth="0">
                      <ValueRefPicker
                        scope={props.scope}
                        value={isResolved(count().items) ? count().items : undefined}
                        onSelect={(items) => {
                          clearOverrides();
                          props.onChange({ kind: 'count', items });
                        }}
                        placeholder="Select a list"
                      />
                    </Column>
                  </>
                )}
              </Show>
              <Show when={formStateValue()}>
                {(formState) => (
                  <>
                    <we-text fontSize="200" color="text-muted" whiteSpace="nowrap">
                      {formState().token === 'error'
                        ? 'error of'
                        : formState().token === 'touched'
                          ? 'edited'
                          : 'valid'}
                    </we-text>
                    <we-select
                      flex="1"
                      size="xs"
                      value={formState().field}
                      options={localFieldOptions()}
                      on:change={(e: CustomEvent) =>
                        props.onChange({ kind: 'formState', token: formState().token, field: e.detail as string })
                      }
                    />
                  </>
                )}
              </Show>
            </Row>
          </Match>

          <Match when={mode() === 'picker'}>
            <ValueRefPicker
              scope={props.scope}
              value={refMode() ? undefined : props.value}
              onSelect={pick}
              allowCount={props.allowCount}
              placeholder={props.placeholder}
            />
          </Match>
        </Switch>
      </Column>
      {modeButtons()}
    </Row>
  );
}

// Re-exported for existing consumers; the implementations live in ../helpers.
export { operandLabel, operandValueType } from '../helpers';
