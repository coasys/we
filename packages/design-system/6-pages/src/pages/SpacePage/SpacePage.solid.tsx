import '@we/block-solid/styles';

import { Column, Row } from '@we/components/solid';
import { JSX } from 'solid-js';

export interface SpacePageProps {
  // Slots
  sidebar?: JSX.Element;
  header?: JSX.Element;
  // Router outlet for sub-pages
  children?: JSX.Element;
  // Styling
  class?: string;
  styles?: JSX.CSSProperties;
}

export function SpacePage(props: SpacePageProps) {
  const baseClass = 'we-space-page';

  return (
    <Row class={`${baseClass} ${props.class || ''}`} styles={props.styles} data-we-page>
      {/* Sidebar */}
      {props.sidebar && <aside class={`${baseClass}-sidebar`}>{props.sidebar}</aside>}

      {/* Main content */}
      <Column class={`${baseClass}-content`} bg="ui-50">
        {/* Header */}
        {props.header && <header class={`${baseClass}-header`}>{props.header}</header>}

        {/* Sub-page routes */}
        <main class={`${baseClass}-sub-pages`}>{props.children}</main>
      </Column>
    </Row>
  );
}
