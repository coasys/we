import { Column } from '@we/components/solid';
import { JSX } from 'solid-js';

export interface PageNotFoundProps {
  class?: string;
  styles?: JSX.CSSProperties;
}

export function PageNotFound(props: PageNotFoundProps) {
  return (
    <Column
      class={`we-page-not-found ${props.class || ''}`}
      styles={props.styles}
      ax="center"
      bg="ui-0"
      p="500"
      data-we-page
    >
      <we-text size="600">Page not found :_(</we-text>
    </Column>
  );
}
