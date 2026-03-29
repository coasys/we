import { For, type JSX } from 'solid-js';

export type * from './List.types';
import type { ListItem, ListProps } from './List.types';

interface SolidListProps extends ListProps {
  children?: JSX.Element;
  renderItem?: (item: ListItem, index: number) => JSX.Element;
}

function DefaultListItem(props: { item: ListItem }) {
  return (
    <div class="we-list-item">
      {props.item.icon && <we-icon name={props.item.icon} size="20px" color="neutral-500" />}
      <div class="we-list-item__content">
        <we-text fontSize="400">{props.item.label}</we-text>
        {props.item.description && (
          <we-text fontSize="300" color="neutral-500">
            {props.item.description}
          </we-text>
        )}
      </div>
    </div>
  );
}

export function List(props: SolidListProps) {
  const gap = () => props.gap || 'var(--we-space-100)';
  const className = () => `we-list${props.ordered ? ' we-list--ordered' : ''}`;

  // Dynamic-only styles: gap (prop-driven) + consumer overrides
  const dynamicStyles = () => ({ gap: gap(), ...props.styles });

  // If children are provided, render them directly
  if (props.children) {
    const Tag = props.ordered ? 'ol' : 'ul';
    return (
      <Tag class={className()} style={dynamicStyles()}>
        {props.children}
      </Tag>
    );
  }

  // Render from items array
  const Tag = props.ordered ? 'ol' : 'ul';
  return (
    <Tag class={className()} style={dynamicStyles()}>
      <For each={props.items || []}>
        {(item, i) => <li>{props.renderItem ? props.renderItem(item, i()) : <DefaultListItem item={item} />}</li>}
      </For>
    </Tag>
  );
}
