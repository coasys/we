import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ContentShape, ScopeGroup, ValueIf } from '@we/schema-shared';
import {
  classifyContent,
  contentAsText,
  parseValue,
  parseValueIf,
  serializeValue,
  serializeValueIf,
} from '@we/schema-shared';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';

import { CodeViewer } from './CodeViewer';
import { ConditionEditor } from './ConditionEditor';
import { ValueEditor } from './ValueEditor';
import { OperandInput } from './ValueRefPicker';

/**
 * Editor for a node's `children` when it holds content rather than child nodes.
 *
 * Content has three authoring shapes — plain text, a value bound to data, and a
 * conditional between two values — and the mode selector converts between them in both
 * directions. Conversions carry the existing content across where they can: turning text
 * into a conditional seeds the "then" branch with that text, which is also the natural
 * way to author one (write the common case, then add the condition).
 */

const MODE_LABELS: Record<ContentShape, string> = {
  text: 'Text',
  value: 'Data',
  conditional: 'Conditional',
  custom: 'Custom',
};

/**
 * Shown while a mode is switched but not yet usable. Switching mode never destroys the
 * existing content — the schema keeps rendering it until the new form is complete — so
 * this says so rather than leaving the panel looking like the change was lost.
 */
function PendingHint(props: { children: string }) {
  return (
    <Row ay="center" gap="100">
      <we-icon name="info" size="xs" color="text-faint" />
      <we-text fontSize="100" color="text-faint">
        {props.children}
      </we-text>
    </Row>
  );
}

export function ContentEditor(props: {
  /** The node's `children` array. Not named `children` — Solid special-cases that in JSX. */
  content: unknown[] | undefined;
  scope: ScopeGroup[];
  /** Node id — resets the mode when the selection changes. */
  nodeId: string | undefined;
  onTextChange: (value: string) => void;
  onTokenChange: (value: unknown) => void;
  onChildrenChange: (children: unknown[]) => void;
}) {
  const [modeOverride, setModeOverride] = createSignal<ContentShape | null>(null);
  // Working copy of a conditional while it is still incomplete. Until the condition is
  // set there is no valid token to write, and writing a half-built $if would break the
  // render — so the schema keeps its old content until the conditional is usable.
  const [ifDraft, setIfDraft] = createSignal<Partial<ValueIf> | null>(null);

  createEffect(
    on(
      () => props.nodeId,
      () => {
        setModeOverride(null);
        setIfDraft(null);
      },
      { defer: true },
    ),
  );

  const token = createMemo(() => props.content?.[0]);
  const mode = createMemo<ContentShape>(() => modeOverride() ?? classifyContent(props.content));

  const modeOptions = createMemo(() => {
    const modes: ContentShape[] = ['text', 'value', 'conditional'];
    // "Custom" is a state you can leave but not choose.
    if (mode() === 'custom') modes.push('custom');
    return modes.map((m) => ({ label: MODE_LABELS[m], value: m }));
  });

  function switchMode(next: ContentShape) {
    if (next === mode()) return;
    setModeOverride(next);

    if (next === 'text') {
      // The seed is already a complete value, so converting is a single click.
      setIfDraft(null);
      props.onTextChange(contentAsText(token()));
      return;
    }
    if (next === 'conditional') {
      // Carry the current content into the "then" branch rather than discarding it.
      const existing = parseValueIf(token());
      setIfDraft(existing ?? { condition: undefined, then: token() ?? '' });
      return;
    }
    setIfDraft(null);
  }

  // ── Conditional mode ──────────────────────────────────────────────────────

  const currentIf = createMemo<Partial<ValueIf>>(() => ifDraft() ?? parseValueIf(token()) ?? { then: '' });

  function updateIf(patch: Partial<ValueIf>) {
    const next = { ...currentIf(), ...patch };
    setIfDraft(next);
    // Only write once the conditional would actually render something.
    if (next.condition !== undefined && next.condition !== null && next.then !== undefined && next.then !== '') {
      props.onTokenChange(serializeValueIf(next as ValueIf));
      setIfDraft(null);
    }
  }

  const conditionalIncomplete = () => {
    const value = currentIf();
    return value.condition === undefined || value.condition === null || value.then === undefined || value.then === '';
  };

  // ── Data mode ─────────────────────────────────────────────────────────────

  const boundValue = createMemo(() => {
    if (typeof token() === 'string') return undefined;
    return parseValue(token()) ?? undefined;
  });

  return (
    <Column gap="200">
      <Row px="400" ay="center" ax="between" gap="200">
        <we-text fontSize="100" fontWeight="600" textTransform="uppercase" letterSpacing="0.06em" color="text-faint">
          Content
        </we-text>
        <we-select
          size="xs"
          width="130px"
          value={mode()}
          options={modeOptions()}
          on:change={(e: CustomEvent) => switchMode(e.detail as ContentShape)}
        />
      </Row>

      <Show when={mode() === 'text'}>
        <we-textarea
          mx="300"
          value={contentAsText(token())}
          placeholder="Text content"
          rows={2}
          on:change={(e: CustomEvent<string>) => props.onTextChange(e.detail)}
        />
      </Show>

      <Show when={mode() === 'value'}>
        <Column px="400" gap="100">
          <OperandInput
            scope={props.scope}
            value={boundValue()}
            onChange={(operand) => props.onTokenChange(serializeValue(operand))}
            valueType="string"
            allowCount
            placeholder="Bind to a value"
          />
          <Show when={!boundValue() && props.content?.length}>
            <PendingHint>Pick a value to apply this — the current content stays until then.</PendingHint>
          </Show>
        </Column>
      </Show>

      <Show when={mode() === 'conditional'}>
        <Column gap="100" bg="surface-sunken" mx="300" r="200" py="100">
          <ConditionEditor
            label="If"
            condition={currentIf().condition}
            scope={props.scope}
            onChange={(condition) => updateIf({ condition })}
          />
          <Column px="400" pb="200" gap="200">
            <Column gap="100">
              <we-text fontSize="100" fontWeight="600" color="text-muted">
                Then show
              </we-text>
              <ValueEditor
                value={currentIf().then ?? ''}
                scope={props.scope}
                depth={1}
                onChange={(then) => updateIf({ then })}
                placeholder="Value when true"
              />
            </Column>
            <Column gap="100">
              <we-text fontSize="100" fontWeight="600" color="text-muted">
                Otherwise show
              </we-text>
              <ValueEditor
                value={currentIf().else ?? ''}
                scope={props.scope}
                depth={1}
                // An empty branch means "render nothing" — drop the key rather than
                // writing an empty string the renderer would print.
                onChange={(otherwise) => updateIf({ else: otherwise === '' ? undefined : otherwise })}
                placeholder="Value when false"
              />
            </Column>
          </Column>

          <Show when={conditionalIncomplete()}>
            <Column px="400" pb="200">
              <PendingHint>
                Set a condition and a value to apply this — the current content stays until then.
              </PendingHint>
            </Column>
          </Show>
        </Column>
      </Show>

      <Show when={mode() === 'custom'}>
        <Column px="400" gap="100">
          <we-text fontSize="100" color="text-faint">
            Custom expression — edit as JSON, or switch to another mode to replace it.
          </we-text>
          <Column border={`1px solid ${tokenVar('color', 'neutral-100')}`} r="200" overflow="hidden" maxHeight="250px">
            <CodeViewer
              json={JSON.stringify(props.content ?? [], null, 2)}
              onSave={(json) => props.onChildrenChange(JSON.parse(json))}
            />
          </Column>
        </Column>
      </Show>
    </Column>
  );
}
