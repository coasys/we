import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface EventDisplayProps {
  title: string | undefined;
  description: string | undefined;
  startDate: string | undefined;
  endDate: string | undefined;
  location: string | undefined;
  allDay: boolean | undefined;
}

function formatDate(dateStr: string, allDay?: boolean): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (allDay) return date.toLocaleDateString();
  return date.toLocaleString();
}

export function EventDisplay(props: EventDisplayProps) {
  return (
    <Row class="we-event-block" gap="300" ay="start" p="300" border="1px solid neutral-200" r="300">
      <we-icon name="calendar" size="lg" flex="none" mt="2px" />
      <Column gap="100" flex="1">
        <we-text variant="label">{props.title || 'Untitled Event'}</we-text>
        <we-text variant="footnote">
          {formatDate(props.startDate || '', props.allDay)}
          <Show when={props.endDate}>
            {' → '}
            {formatDate(props.endDate!, props.allDay)}
          </Show>
        </we-text>
        <Show when={props.location}>
          <Row gap="100" ay="center">
            <we-icon name="map-pin" size="xs" />
            <we-text variant="footnote">{props.location}</we-text>
          </Row>
        </Show>
        <Show when={props.description}>
          <we-text variant="footnote" color="neutral-700" mt="100">
            {props.description}
          </we-text>
        </Show>
      </Column>
    </Row>
  );
}
