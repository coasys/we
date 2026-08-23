import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface CodeDisplayProps {
  code: string | undefined;
  language: string | undefined;
  title: string | undefined;
}

export function CodeDisplay(props: CodeDisplayProps) {
  return (
    <Column class="we-code-block" gap="0">
      <Show when={props.language || props.title}>
        <Row p="200" bg="surface-sunken" r="300">
          <we-text variant="footnote">{props.title || props.language}</we-text>
        </Row>
      </Show>
      <we-code block>{props.code || ''}</we-code>
    </Column>
  );
}
