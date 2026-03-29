export interface AccordionItem {
  id?: string;
  title: string;
  content?: string;
  disabled?: boolean;
}

export interface AccordionProps {
  items?: AccordionItem[];
  multiple?: boolean;
  styles?: Record<string, string | number>;
}
