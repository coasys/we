import { For } from 'solid-js';

export type * from './Breadcrumbs.types';
import type { BreadcrumbItem, BreadcrumbsProps } from './Breadcrumbs.types';

interface SolidBreadcrumbsProps extends BreadcrumbsProps {
  onNavigate?: (item: BreadcrumbItem, index: number) => void;
}

export function Breadcrumbs(props: SolidBreadcrumbsProps) {
  const items = () => props.items || [];
  const separator = () => props.separator || '/';

  return (
    <nav aria-label="Breadcrumbs" style={props.styles}>
      <ol class="we-breadcrumbs">
        <For each={items()}>
          {(item, i) => {
            const isLast = () => i() === items().length - 1;
            return (
              <>
                <li class="we-breadcrumbs__item">
                  {item.icon && <we-icon name={item.icon} size="14px" />}
                  {isLast() ? (
                    <span class="we-breadcrumbs__current" aria-current="page">
                      {item.label}
                    </span>
                  ) : (
                    <a
                      class="we-breadcrumbs__link"
                      href={item.href || '#'}
                      onClick={(e) => {
                        if (props.onNavigate) {
                          e.preventDefault();
                          props.onNavigate(item, i());
                        }
                      }}
                    >
                      {item.label}
                    </a>
                  )}
                </li>
                {!isLast() && (
                  <li class="we-breadcrumbs__separator" aria-hidden="true">
                    {separator()}
                  </li>
                )}
              </>
            );
          }}
        </For>
      </ol>
    </nav>
  );
}
