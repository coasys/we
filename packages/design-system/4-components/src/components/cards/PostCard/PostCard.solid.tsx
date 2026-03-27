import { JSX } from 'solid-js';

import { Column } from '../../layout/Column/Column.solid';
import { Row } from '../../layout/Row/Row.solid';

export interface PostCardProps {
  creator?: { name: string; avatar: string };
  title: string;
  text: string;
  class?: string;
  styles?: JSX.CSSProperties;
}

export function PostCard(props: PostCardProps) {
  return (
    <Column
      class={`we-post-card ${props.class || ''}`}
      styles={props.styles}
      bg="neutral-100"
      gap="300"
      p="400"
      r="md"
      data-we-card
    >
      {props.creator && (
        <Row ay="center" gap="300">
          <we-avatar image={props.creator.avatar} size="md" />
          <we-text fontSize="600">{props.creator.name}</we-text>
        </Row>
      )}

      <Column gap="100">
        <we-text tag="h3" fontSize="600" fontWeight="600">
          {props.title}
        </we-text>
        <we-text tag="p" fontSize="400">
          {props.text}
        </we-text>
      </Column>
    </Column>
  );
}
