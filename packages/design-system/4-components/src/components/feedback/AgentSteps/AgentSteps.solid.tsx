/*
  The tool calls behind an agent's reply, drawn the same way wherever a reply runs — open while it
  runs, folded to a count once it has settled.

  Ported from the editor's AI panel (coasys/we#416 by jhweir) into a shared component, so the
  app-level chats and the editor's panel do not carry two copies of the same reading. One change on
  top of the port: a step whose call *wrote* — create, update, delete, add_link and their kin — is
  marked in orange after the fact, which is the chat's honest answer to "the AI writes straight
  away" with no confirm step.
*/
import { tokenVar } from '@we/design-utils';
import { createSignal, For, Show } from 'solid-js';

import { Column } from '../../layout/Column/Column.solid';
import { Row } from '../../layout/Row/Row.solid';
import type { AgentStep, AgentStepsProps } from './AgentSteps.types';
import { isWroteStep, stepWords } from './stepWords';

export type { AgentStep, AgentStepsProps };
export { isWroteStep, stepWords };

/**
 * A finished step's mark: how its call went, or that the reply ended before it did, all faint.
 * A done step, by far the most common, is a plain tick, so a reply that worked reads quietly; the
 * rarer outcomes are circled, which is what makes them stand out from it.
 * A stopped step is a minus rather than an x: somebody chose to stop it, so it should not read as
 * a second kind of failure beside the warning.
 * A failed step is not red: when the whole reply failed the line under the steps already says so
 * in red, and when it did not, the agent got past the failure and it is not news.
 */
const STEP_MARK: Record<Exclude<AgentStep['outcome'], 'running'>, string> = {
  ok: 'check',
  error: 'warning-circle',
  stopped: 'minus-circle',
};

/** The tint a write carries once it has happened — orange, for "this changed something". */
const WROTE_COLOR = tokenVar('color', 'warning-text');

function StepRow(props: { step: AgentStep }) {
  const wrote = () => isWroteStep(props.step);
  return (
    <Row ay="center" gap="200" minWidth="0">
      {/* One slot for every mark, so the text lines up whichever is drawn. The spinner is a
          size smaller: its ring fills its box, where a glyph leaves a margin round itself. */}
      <Row width="var(--we-size-xs)" height="var(--we-size-xs)" ax="center" ay="center" flexShrink="0">
        <Show when={props.step.outcome !== 'running'} fallback={<we-animated-icon name="spinner" size="xxs" />}>
          <we-icon
            name={STEP_MARK[props.step.outcome as keyof typeof STEP_MARK]}
            size="xs"
            color={wrote() ? WROTE_COLOR : 'text-faint'}
          />
        </Show>
      </Row>
      <we-text variant="footnote" color={wrote() ? WROTE_COLOR : 'text-faint'} truncate>
        {props.step.refused
          ? `${stepWords(props.step)} — refused: outside what this chat may reach`
          : props.step.error
            ? `${stepWords(props.step)}: ${props.step.error}`
            : stepWords(props.step)}
        {props.step.target ? ` — ${props.step.target}` : ''}
        {props.step.summary ? ` · ${props.step.summary}` : ''}
      </we-text>
    </Row>
  );
}

/** The tool calls behind a reply: open while it runs, folded to a count once it has settled. */
export function AgentSteps(props: AgentStepsProps) {
  const [unfolded, setUnfolded] = createSignal<boolean | null>(null);
  const open = () => unfolded() ?? props.running;
  return (
    <Column gap="100" data-testid="agent-steps">
      <Show when={!props.running}>
        <we-button variant="bare" size="xs" alignSelf="flex-start" onClick={() => setUnfolded(!open())}>
          <Row ay="center" gap="100">
            <we-icon name={open() ? 'caret-down' : 'caret-right'} size="xs" color="text-muted" />
            <we-text variant="footnote" color="text-muted">
              {props.steps.length === 1 ? '1 step' : `${props.steps.length} steps`}
            </we-text>
          </Row>
        </we-button>
      </Show>
      <Show when={open()}>
        <For each={props.steps}>{(step) => <StepRow step={step} />}</For>
      </Show>
    </Column>
  );
}
