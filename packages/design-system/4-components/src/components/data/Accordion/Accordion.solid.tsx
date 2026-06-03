import { createSignal, For, type JSX } from 'solid-js';

export type * from './Accordion.types';
import type { AccordionItem, AccordionProps } from './Accordion.types';

interface SolidAccordionProps extends AccordionProps {
  children?: JSX.Element;
  renderContent?: (item: AccordionItem, index: number) => JSX.Element;
  onChange?: (openItems: string[]) => void;
}

export function Accordion(props: SolidAccordionProps) {
  const [openItems, setOpenItems] = createSignal<Set<string>>(new Set());

  const toggle = (id: string, disabled?: boolean) => {
    if (disabled) return;
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!props.multiple) next.clear();
        next.add(id);
      }
      props.onChange?.([...next]);
      return next;
    });
  };

  const isOpen = (id: string) => openItems().has(id);

  return (
    <div class="we-accordion" style={props.styles}>
      <For each={props.items || []}>
        {(item, i) => {
          const id = () => item.id || `accordion-${i()}`;
          return (
            <div class="we-accordion__item">
              <button
                class={`we-accordion__trigger${item.disabled ? ' we-accordion__trigger--disabled' : ''}${isOpen(id()) ? ' we-accordion__trigger--open' : ''}`}
                aria-expanded={isOpen(id()) ? 'true' : 'false'}
                aria-controls={`panel-${id()}`}
                onClick={() => toggle(id(), item.disabled)}
              >
                <span>{item.title}</span>
                <we-icon class="we-accordion__trigger__icon" name="caret-down" size="16px" />
              </button>
              <div
                id={`panel-${id()}`}
                class={`we-accordion__panel${isOpen(id()) ? ' we-accordion__panel--open' : ''}`}
                role="region"
                aria-labelledby={`trigger-${id()}`}
              >
                <div class="we-accordion__content">
                  {props.renderContent ? props.renderContent(item, i()) : item.content}
                </div>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
