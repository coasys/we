import { Column, Row } from '@we/components/solid';
import { createMemo, Show } from 'solid-js';

interface TaskDisplayProps {
  title: string | undefined;
  description: string | undefined;
  status: string | undefined;
  priority: string | undefined;
  dueDate: string | undefined;
  assignee: string | undefined;
}

type TagVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const PRIORITY_VARIANTS: Record<string, TagVariant> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
};

export function TaskDisplay(props: TaskDisplayProps) {
  const isDone = createMemo(() => props.status === 'done');

  return (
    <Row class="we-task-block" gap="300" ay="start" p="300" border="1px solid border" r="300">
      <we-icon name={isDone() ? 'check-square' : 'square'} size="sm" flex="none" mt="2px" />
      <Column gap="100" flex="1">
        <we-text
          variant="label"
          textDecoration={isDone() ? 'line-through' : 'none'}
          color={isDone() ? 'neutral-400' : undefined}
        >
          {props.title || 'Untitled Task'}
        </we-text>
        <Row gap="200" ay="center">
          <Show when={props.priority}>
            <we-tag variant={PRIORITY_VARIANTS[props.priority!] || 'neutral'} fontSize="200">
              {props.priority}
            </we-tag>
          </Show>
          <Show when={props.dueDate}>
            <we-text variant="footnote" color="text-muted">
              Due: {new Date(props.dueDate!).toLocaleDateString()}
            </we-text>
          </Show>
          <Show when={props.assignee}>
            <we-text variant="footnote" color="text-muted">
              @{props.assignee}
            </we-text>
          </Show>
        </Row>
      </Column>
    </Row>
  );
}
