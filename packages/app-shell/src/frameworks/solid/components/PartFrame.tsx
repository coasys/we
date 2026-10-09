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
import { Column, Row } from '@we/components/solid';
import { findNodeById, PART_ATTR, PART_NODE_ATTR, type SchemaNode, type TemplateSchema } from '@we/schema-shared';
import { createMemo, type JSX, Show } from 'solid-js';

import { useDatasetStore } from '../stores/DatasetStore';
import { useEditorStore } from '../stores/EditorStore';
import { useShellStore } from '../stores/ShellStore';
import { useSpaceStore } from '../stores/SpaceStore';
import { useTemplateStore } from '../stores/TemplateStore';

const humanise = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export function PartFrame(props: { part: string; at?: string; children?: JSX.Element }) {
  const spaceStore = useSpaceStore();
  const datasetStore = useDatasetStore();

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
        <div style={{ display: 'contents' }} {...frameAttrs(props)}>
          {props.children}
        </div>
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

function frameAttrs(props: { part: string; at?: string }) {
  return { [PART_ATTR]: props.part, ...(props.at ? { [PART_NODE_ATTR]: props.at } : {}) };
}

/**
 * What stands where a part cannot draw.
 *
 * In full while the template is being edited, which is when somebody can do something about it from
 * here. Otherwise one quiet line, and only to somebody who can act on it — a visitor told "this needs
 * a module you cannot turn on" has been given a problem with no answer.
 */
function MissingPart(props: { part: string; at?: string; why: MissingPartReason }) {
  const spaceStore = useSpaceStore();
  const shellStore = useShellStore();
  const editorStore = useEditorStore();
  const templateStore = useTemplateStore();
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

  const editing = () => editorStore.isEditingTemplate() && !editorStore.isReadOnly();

  const remove = () => {
    const at = props.at;
    if (!at) return;
    const template = structuredClone(templateStore.currentTemplate) as SchemaNode;
    const found = findNodeById(template, at);
    if (!found?.parent || found.key !== 'children' || !found.parent.children) return;
    found.parent.children.splice(found.index, 1);
    editorStore.pushSnapshot();
    templateStore.updateTemplate(template as TemplateSchema);
    void editorStore.commitEdit();
  };

  return (
    <Show
      when={editing()}
      fallback={
        <Show when={fix()}>
          {(action) => (
            <Row ay="center" gap="200" color="text-muted">
              <we-text variant="footnote">
                {label()} needs {moduleName()}.
              </we-text>
              <we-button size="xs" variant="ghost" onClick={() => action().go()}>
                {action().label}
              </we-button>
            </Row>
          )}
        </Show>
      }
    >
      <Column gap="200" p="300" r="surface" border="1px dashed border" color="text-muted">
        <Row ay="center" gap="200">
          <we-icon name="puzzle-piece" size="sm" />
          <we-text variant="label" color="text">
            {label()} is not here
          </we-text>
        </Row>
        <we-text variant="footnote">{reason()}</we-text>
        <Row gap="200" wrap>
          <Show when={fix()}>
            {(action) => (
              <we-button size="xs" variant="secondary" onClick={() => action().go()}>
                {action().label}
              </we-button>
            )}
          </Show>
          <Show when={props.at}>
            <we-button size="xs" variant="ghost" onClick={remove}>
              Remove from template
            </we-button>
          </Show>
        </Row>
      </Column>
    </Show>
  );
}

export default PartFrame;
