import { Row } from '@we/components/solid';
import { JSX } from 'solid-js';

export type CenteredTemplateProps = {
  // Slots
  sidebarLeft?: JSX.Element;
  sidebarRight?: JSX.Element;
  modals?: JSX.Element;
  // Router outlet for pages
  children?: JSX.Element;
  // Styling
  class?: string;
  styles?: JSX.CSSProperties;
};

export function CenteredTemplate(props: CenteredTemplateProps) {
  const baseClass = 'we-centered-template';

  return (
    <Row class={`${baseClass} ${props.class || ''}`} bg="ui-0" ax="center" styles={props.styles} data-we-template>
      <Row class={`${baseClass}-container`}>
        {props.sidebarLeft && <aside class={`${baseClass}-sidebar`}>{props.sidebarLeft}</aside>}
        <main class={`${baseClass}-content`}>{props.children}</main>
        {props.sidebarRight && <aside class={`${baseClass}-sidebar`}>{props.sidebarRight}</aside>}
      </Row>

      {props.modals}
    </Row>
  );
}
