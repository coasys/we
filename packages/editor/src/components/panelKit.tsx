/**
 * The kit's panel fragments, for the editor's hand-written panels.
 *
 * A module's panel is a schema and places `panelShell`, `panelScroll` and `foldingSectionLabel`
 * from `@we/schema-kit` directly. The editor's panels are Solid, so a fragment cannot be placed in
 * them — and drawn by hand they drifted: section headings with their own padding and dividers, a
 * scroll area whose content narrowed when its scrollbar appeared, titles whose capitals never
 * arrived. These draw the same thing from the same values (`panelScrollProps`, the label props,
 * `CARET_SIZE`), so a change to the kit reaches both.
 */
import { Column, Row } from '@we/components/solid';
import { weProps } from '@we/design-utils/solid';
import { CARET_SIZE, PANEL_TITLE_PROPS, panelScrollProps, SECTION_LABEL_PROPS } from '@we/schema-kit';
import { createEffect, createSignal, type JSX, Show } from 'solid-js';

/** The panel's padding: `panelShell`'s figure, and what `PanelScroll` bleeds back out through. */
const PANEL_INSET = '300';

/** A panel: its name at the top, then its content — `panelShell`. */
export function PanelShell(props: {
  title: string;
  aside?: JSX.Element;
  /** A press anywhere in the panel — the theme panel holds its measurements still for a drag. */
  onPointerDown?: () => void;
  children: JSX.Element;
}) {
  return (
    <Column
      width="100%"
      height="100%"
      p={PANEL_INSET}
      gap="300"
      overflow="hidden"
      onPointerDown={() => props.onPointerDown?.()}
    >
      <Row width="100%" ay="center" gap="200" flex="0 0 auto">
        <we-text {...weProps(PANEL_TITLE_PROPS)} flex="1">
          {props.title}
        </we-text>
        {props.aside}
      </Row>
      {props.children}
    </Column>
  );
}

/**
 * The panel's scrolling body — `panelScroll`: its gutter held whether or not it scrolls, so
 * opening a section that makes the content taller than the panel does not narrow everything above
 * it, and the bar drawn in the panel's own padding rather than over the content.
 */
export function PanelScroll(props: { children: JSX.Element }) {
  return <we-scroll-area {...weProps(panelScrollProps(PANEL_INSET))}>{props.children}</we-scroll-area>;
}

/**
 * A section that folds — `foldingSectionLabel` over its body.
 *
 * The whole heading is the button, bare, so it looks like a label and acts like a control: the
 * keyboard and the disclosure state come with it. Sections are spaced by the column they sit in,
 * not by dividers or padding of their own, as a module panel's are.
 */
export function FoldingSection(props: {
  title: string;
  defaultOpen?: boolean;
  /**
   * Opens the section when it turns truthy — for arriving at a row inside a collapsed section.
   *
   * A section owns whether it is open, which is right for a click on its heading and useless for
   * being sent to something inside it: the inspector's "take me to this role" landed on a row that
   * was not rendered, so the scroll had nothing to scroll to. Only ever opens.
   */
  openOn?: () => unknown;
  /** Whether it is open, held by the caller — for a section whose state outlives the panel. */
  open?: () => boolean;
  onToggle?: (open: boolean) => void;
  children: JSX.Element;
}) {
  const [own, setOwn] = createSignal(props.defaultOpen ?? false);
  const open = () => (props.open ? props.open() : own());
  const setOpen = (next: boolean) => (props.onToggle ? props.onToggle(next) : setOwn(next));
  createEffect(() => {
    if (props.openOn?.()) setOpen(true);
  });
  return (
    <Column gap="200" width="100%">
      <we-button variant="bare" width="100%" r="200" expanded={open()} onClick={() => setOpen(!open())}>
        <Row width="100%" ay="center" gap="200">
          <we-text {...weProps(SECTION_LABEL_PROPS)} flex="1">
            {props.title}
          </we-text>
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size={CARET_SIZE} color="text-faint" />
        </Row>
      </we-button>
      <Show when={open()}>
        <Column gap="300" width="100%">
          {props.children}
        </Column>
      </Show>
    </Column>
  );
}
