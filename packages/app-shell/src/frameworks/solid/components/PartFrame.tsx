/**
 * Where a module's part is placed: the part itself when its module is here to draw it, and otherwise
 * a placeholder saying what is missing, why, and where to fix it.
 *
 * `resolveParts` wraps every `$part` in one of these. Two jobs, both about the part belonging to
 * somebody other than whoever placed it:
 *
 * - **Saying where it came from.** The wrapper carries the part's id and the `$part` node's own, so
 *   the visual editor selects the template's node — the placement — rather than a node of the
 *   module's, which the template cannot edit. Box-less, so a part lays out exactly as before.
 * - **Standing in when it cannot draw.** A part whose module this build does not include, that this
 *   person has turned off, or that this space has turned off used to render nothing and report
 *   itself to the console. A template with a hole in it reads as a broken template, so the hole now
 *   says what belongs there and how to get it back — or how to take it out.
 *
 * Inside a space a part follows its module's availability there: a community that turned a capability
 * off should not find its pieces still working in a template. Outside a space — settings, the root
 * chrome — only whether this build has the module at all counts, since no space has decided anything.
 */
import { describeMissing, fixFor, type MissingPart as MissingPartReason, whyMissing } from '@shared/partAvailability';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { Row } from '@we/components/solid';
import { PART_ATTR, PART_NODE_ATTR } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { useDatasetStore } from '../stores/DatasetStore';
import { useEditorStore } from '../stores/EditorStore';
import { useShellStore } from '../stores/ShellStore';
import { useSpaceStore } from '../stores/SpaceStore';

const humanise = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export function PartFrame(props: { part: string; at?: string; children?: JSX.Element }) {
  const spaceStore = useSpaceStore();
  const datasetStore = useDatasetStore();
  const editorStore = useEditorStore();

  const moduleId = () => props.part.split('.')[0] ?? '';

  const missing = createMemo(() =>
    whyMissing({
      registered: !!moduleRegistry.get(moduleId()),
      published: !!moduleRegistry.parts()[props.part],
      inSpace: !!datasetStore.currentDataset(),
      active: spaceStore.activeModules().includes(moduleId()),
      installed: spaceStore.installedModules().includes(moduleId()),
      enabled: spaceStore.enabledModules().includes(moduleId()),
    }),
  );

  return (
    <Show
      when={missing()}
      fallback={
        <PresentPart part={props.part} at={props.at} editing={editorStore.contentMode() === 'visual'}>
          {props.children}
        </PresentPart>
      }
    >
      {(why) => (
        <div style={{ display: 'contents' }} {...frameAttrs(props)}>
          <MissingPart part={props.part} at={props.at} why={why()} />
        </div>
      )}
    </Show>
  );
}

/** Marks the stand-in an empty part draws while edited, so measuring what the part drew skips it. */
const EMPTY_ATTR = 'data-we-part-empty';

/** Whether an element, or anything a box-less one holds, takes up room on the page. */
function hasBox(el: Element): boolean {
  if (el.hasAttribute(EMPTY_ATTR)) return false;
  if (getComputedStyle(el).display === 'contents') return [...el.children].some(hasBox);
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/**
 * A part whose module is here, drawing whatever it draws — which can be nothing.
 *
 * Many parts draw only when there is something to say: a microphone meter outside a call, a
 * status note with nothing to report. Placed from the palette in a quiet moment, such a part had no
 * box, so it could not be ringed or pressed and looked as though adding it had done nothing. While the
 * template is edited, an empty part draws a slim stand-in naming itself, which is selectable through
 * the frame like the part. Only then: outside editing it draws nothing, as its module meant.
 */
export function PresentPart(props: { part: string; at?: string; editing: boolean; children?: JSX.Element }) {
  let frame: HTMLDivElement | undefined;
  const [empty, setEmpty] = createSignal(false);
  const label = () => moduleRegistry.parts()[props.part]?.label ?? humanise(props.part.split('.')[1] ?? props.part);

  createEffect(() => {
    if (!props.editing || !frame) {
      setEmpty(false);
      return;
    }
    const el = frame;
    // Whether anything the part drew has a box, judged after the frame it changed in has laid out.
    let pending = 0;
    const check = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setEmpty(![...el.children].some(hasBox)));
    };
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true });
    check();
    onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(pending);
    });
  });

  return (
    <div ref={frame} style={{ display: 'contents' }} {...frameAttrs(props)}>
      {props.children}
      <Show when={props.editing && empty()}>
        <div style={{ display: 'contents' }} {...{ [EMPTY_ATTR]: '' }}>
          <Row ay="center" gap="200" px="300" py="100" r="control" border="1px dashed border" color="text-muted">
            <we-icon name="puzzle-piece" size="xs" />
            <we-text variant="footnote">{label()} · nothing to show right now</we-text>
          </Row>
        </div>
      </Show>
    </div>
  );
}

function frameAttrs(props: { part: string; at?: string }) {
  return { [PART_ATTR]: props.part, ...(props.at ? { [PART_NODE_ATTR]: props.at } : {}) };
}

/**
 * What stands where a part cannot draw: small, in place, with the details a step away.
 *
 * It used to be a card naming the part, the reason, a fix and a way to remove it — far bigger than
 * the icon button it stood in for, so a row of controls grew a box in the middle of it. The part
 * never rendered, so there is no size of its own to keep; most parts are controls, so a control's
 * square is the honest guess, and it sits inline so a row keeps its line.
 *
 * The reason and the fix are where somebody looks for them rather than drawn every time. While the
 * template is edited, the editor's ring names the part and why it is not here, and pressing it
 * selects the part, whose card carries the fix and the way to remove it. Outside editing, somebody
 * who can act gets the reason on hover and the fix on a press; anybody else sees nothing — "this
 * needs a module you cannot turn on" is a problem with no answer.
 */
function MissingPart(props: { part: string; at?: string; why: MissingPartReason }) {
  const spaceStore = useSpaceStore();
  const shellStore = useShellStore();
  const editorStore = useEditorStore();
  const datasetStore = useDatasetStore();

  const moduleId = () => props.part.split('.')[0] ?? '';
  const moduleName = () => moduleRegistry.get(moduleId())?.definition.manifest.name ?? humanise(moduleId());
  const label = () => moduleRegistry.parts()[props.part]?.label ?? humanise(props.part.split('.')[1] ?? props.part);

  const reason = () =>
    describeMissing(props.why, { moduleName: moduleName(), canAdminister: spaceStore.canAdministerCurrentSpace() });

  const fix = () =>
    fixFor(props.why, {
      canAdminister: spaceStore.canAdministerCurrentSpace(),
      datasetId: datasetStore.currentDataset()?.id,
      openShellView: shellStore.openShellView,
      openSpaceSettings: shellStore.openSpaceSettings,
    });

  return (
    <MissingMarker
      label={label()}
      reason={reason()}
      editing={editorStore.contentMode() === 'visual'}
      fix={fix() ?? undefined}
    />
  );
}

/**
 * The marker itself, from what it says and what it does — kept apart from the stores so it can be
 * looked at on its own.
 */
export function MissingMarker(props: {
  label: string;
  reason: string;
  editing: boolean;
  fix?: { label: string; go: () => void };
}) {
  const glyph = () => (
    <Row position="relative" width="24px" height="24px" ax="center" ay="center" flexShrink={0}>
      <we-icon name="puzzle-piece" size="xs" color="text-muted" />
      <Row position="absolute" top="2px" right="2px" width="6px" height="6px" r="full" bg="warning-text" />
    </Row>
  );
  return (
    <Show
      when={props.editing}
      fallback={
        <Show when={props.fix}>
          {(action) => (
            <we-tooltip content={`${props.label} is not here. ${props.reason} ${action().label}.`}>
              <we-button
                data-we-part-missing=""
                size="xs"
                variant="ghost"
                square
                label={`${props.label} is not here — ${action().label}`}
                onClick={() => action().go()}
              >
                {glyph()}
              </we-button>
            </we-tooltip>
          )}
        </Show>
      }
    >
      <span data-we-part-missing="" style={{ display: 'inline-flex', 'flex-shrink': '0' }}>
        <Row r="control" border="1px dashed border">
          {glyph()}
        </Row>
      </span>
    </Show>
  );
}

export default PartFrame;
