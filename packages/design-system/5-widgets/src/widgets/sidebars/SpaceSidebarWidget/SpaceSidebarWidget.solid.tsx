import { Column, Row } from '@we/components/solid';
import { Accessor, JSX } from 'solid-js';

export interface SpaceSidebarWidgetProps {
  name: Accessor<string>;
  description?: Accessor<string>;
  // image?: Accessor<string>;
  class?: string;
  style?: JSX.CSSProperties;
}

export function SpaceSidebarWidget(props: SpaceSidebarWidgetProps) {
  return (
    <Column class={`we-space-sidebar-widget ${props.class || ''}`} bg="ui-25" data-we-sidebar>
      <div style={{ height: '200px', background: 'linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab)' }} />
      <Column gap="400">
        <Row gap="300" ay="center">
          {/* <we-avatar size="xxl" image={props.image?.()} /> */}
          <we-text size="800" weight="500">
            {props.name()}
          </we-text>
        </Row>

        {props.description && <we-text>{props.description()}</we-text>}
      </Column>
    </Column>
  );
}
