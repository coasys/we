import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ConditionOperand, FormStateToken, ScopeGroup, ScopeRef, ScopeValueType } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

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

const FORM_STATE_LABELS: Record<FormStateToken, (field: string) => string> = {
  formValid: () => 'all fields are valid',
  valid: (field) => `${field} is valid`,
  touched: (field) => `${field} was edited`,
  error: (field) => `${field} error message`,
};

export function operandLabel(operand: ConditionOperand | undefined): string {
  if (!operand) return '';
  switch (operand.kind) {
    case 'store':
    case 'local':
    case 'context':
      return operand.path;
    case 'list':
      return operand.value.join(', ');
    case 'count':
      return `count of ${operandLabel(operand.items) || '…'}`;
    case 'formState':
      return FORM_STATE_LABELS[operand.token](operand.field);
    case 'literal':
      if (operand.value === null) return 'null';
      if (operand.value === '') return '';
      return String(operand.value);
  }
}

function operandIcon(operand: ConditionOperand | undefined): string {
  if (!operand) return 'plus';
  if (operand.kind === 'literal' || operand.kind === 'list') return 'text-aa';
  if (operand.kind === 'count') return 'hash';
  if (operand.kind === 'formState') return 'check-circle';
  return KIND_ICONS[operand.kind];
}

/** The referenced path, or undefined for operands that aren't a plain reference. */
function refPath(operand: ConditionOperand | undefined): string | undefined {
  if (!operand) return undefined;
  return operand.kind === 'store' || operand.kind === 'local' || operand.kind === 'context' ? operand.path : undefined;
}

/** Map a scope ref onto the operand kind that serializes to the same token. */
function refToOperand(ref: ScopeRef): ConditionOperand {
  if (ref.kind === 'store') return { kind: 'store', path: ref.path };
  if (ref.kind === 'local') return { kind: 'local', path: ref.path };
  return { kind: 'context', path: ref.path };
}

/** The declared type of the picked reference, used to type the opposite side's literal input. */
export function operandValueType(operand: ConditionOperand | undefined, scope: ScopeGroup[]): ScopeValueType {
  if (!operand) return 'unknown';
  if (operand.kind === 'literal') {
    if (typeof operand.value === 'boolean') return 'boolean';
    if (typeof operand.value === 'number') return 'number';
    return 'string';
  }
  if (operand.kind === 'list') return 'array';
  if (operand.kind === 'count') return 'number';
  if (operand.kind === 'formState') return operand.token === 'error' ? 'string' : 'boolean';
  for (const group of scope) {
    for (const ref of group.refs) {
      if (ref.path === operand.path) return ref.valueType;
    }
  }
  return 'unknown';
}

// ── ValueRefPicker ──────────────────────────────────────────────────────────

export function ValueRefPicker(props: {
  scope: ScopeGroup[];
  value?: ConditionOperand;
  onSelect: (operand: ConditionOperand) => void;
  /** Offer a "use a fixed value" entry that switches the operand to literal mode. */
  allowLiteral?: boolean;
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
          <we-icon name={operandIcon(props.value)} size="xs" color="neutral-400" />
          <we-text flex="1" truncate fontSize="200" color={props.value ? 'neutral-800' : 'neutral-400'}>
            {label()}
          </we-text>
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size="xs" color="neutral-400" />
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
                placeholder="Search values…"
                value={search()}
                on:input={(e: CustomEvent<string>) => setSearch(e.detail)}
              />

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
                          color="neutral-400"
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
                                <we-icon name={KIND_ICONS[scopeRef.kind]} size="xs" color="neutral-400" />
                                <we-text fontSize="200" truncate>
                                  {scopeRef.label}
                                </we-text>
                                <Show when={scopeRef.valueType !== 'unknown'}>
                                  <we-text fontSize="100" color="neutral-400">
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
                    <we-text px="200" py="200" fontSize="200" color="neutral-400">
                      Nothing in scope matches.
                    </we-text>
                  </Show>
                </Column>
              </we-scroll-area>

              <Show when={props.allowLiteral || props.allowCount}>
                <Column borderTop={`1px solid ${tokenVar('color', 'neutral-100')}`} pt="100">
                  <Show when={props.allowCount}>
                    <we-menu-item on:select={() => choose({ kind: 'count', items: { kind: 'context', path: '' } })}>
                      <Row ay="center" gap="200">
                        <we-icon name="hash" size="xs" color="neutral-400" />
                        <we-text fontSize="200">Count of a list…</we-text>
                      </Row>
                    </we-menu-item>
                  </Show>
                  <Show when={props.allowLiteral}>
                    <we-menu-item on:select={() => choose({ kind: 'literal', value: '' })}>
                      <Row ay="center" gap="200">
                        <we-icon name="text-aa" size="xs" color="neutral-400" />
                        <we-text fontSize="200">Use a fixed value…</we-text>
                      </Row>
                    </we-menu-item>
                  </Show>
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
  placeholder?: string;
}) {
  const isLiteral = () => props.value?.kind === 'literal' || props.value?.kind === 'list';

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

  /** Swap back to picking a reference, discarding the current composite/literal value. */
  const resetToRef = () => props.onChange({ kind: 'context', path: '' });

  const resetButton = (title: string) => (
    <we-tooltip title={title}>
      <we-button variant="ghost" size="xs" square onClick={resetToRef} aria-label={title}>
        <we-icon name="arrow-counter-clockwise" size="xs" />
      </we-button>
    </we-tooltip>
  );

  // `$count` wraps another reference, so it renders as a labelled row containing a
  // nested picker rather than as a leaf control.
  const countValue = () => (props.value?.kind === 'count' ? props.value : null);

  // Validation-state readers name a field from the surrounding $localState, which is
  // exactly the `local` group of the scope — so the field list comes for free.
  const formStateValue = () => (props.value?.kind === 'formState' ? props.value : null);
  const localFieldOptions = () => {
    const fields = props.scope.filter((g) => g.kind === 'local').flatMap((g) => g.refs.map((r) => r.path));
    return [{ label: 'the whole form', value: '$scope' }, ...fields.map((f) => ({ label: f, value: f }))];
  };

  return (
    <Show
      when={!countValue() && !formStateValue()}
      fallback={
        <Row ay="center" gap="100" minWidth="0">
          <Show when={countValue()}>
            {(count) => (
              <>
                <we-text fontSize="200" color="neutral-500" styles={{ 'white-space': 'nowrap' }}>
                  count of
                </we-text>
                <Column flex="1" minWidth="0">
                  <ValueRefPicker
                    scope={props.scope}
                    value={count().items}
                    onSelect={(items) => props.onChange({ kind: 'count', items })}
                    placeholder="Select a list"
                  />
                </Column>
              </>
            )}
          </Show>
          <Show when={formStateValue()}>
            {(formState) => (
              <>
                <we-text fontSize="200" color="neutral-500" styles={{ 'white-space': 'nowrap' }}>
                  {formState().token === 'error' ? 'error of' : formState().token === 'touched' ? 'edited' : 'valid'}
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
          {resetButton('Pick a different value')}
        </Row>
      }
    >
      <Show
        when={isLiteral()}
        fallback={
          <ValueRefPicker
            scope={props.scope}
            value={props.value}
            onSelect={props.onChange}
            allowLiteral
            allowCount={props.allowCount}
            placeholder={props.placeholder}
          />
        }
      >
        <Row ay="center" gap="100" minWidth="0">
          {literalControl()}
          <we-tooltip title="Pick a value from data instead">
            <we-button variant="ghost" size="xs" square onClick={resetToRef} aria-label="Pick from data">
              <we-icon name="database" size="xs" />
            </we-button>
          </we-tooltip>
        </Row>
      </Show>
    </Show>
  );
}
