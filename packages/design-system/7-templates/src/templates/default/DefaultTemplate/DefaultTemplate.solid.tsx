import { Column, Row } from '@we/components/solid';
import { JSX } from 'solid-js';

export type DefaultTemplateProps = {
  // Slots
  sidebar?: JSX.Element;
  header?: JSX.Element;
  modals?: JSX.Element;
  // Router outlet for pages
  children?: JSX.Element;
  // Styling
  class?: string;
  styles?: JSX.CSSProperties;
};

export function DefaultTemplate(props: DefaultTemplateProps) {
  const baseClass = 'we-default-template';

  return (
    <Row class={`${baseClass} ${props.class || ''}`} styles={props.styles} data-we-template>
      {props.sidebar && <aside class={`${baseClass}-sidebar`}>{props.sidebar}</aside>}

      <Column class={`${baseClass}-content`} ax="center" bg="ui-50">
        {props.header && <header class={`${baseClass}-header`}>{props.header}</header>}
        <main class={`${baseClass}-pages`}>{props.children}</main>
      </Column>

      {props.modals}
    </Row>
  );
}
