/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * An edit made in the editor redraws the node it touched and nothing else, under the Solid adapter.
 *
 * The editor writes through the edit target into the template store's live document; Solid's is a
 * nested store edited at the paths that changed. Drawn through the real renderer, a sibling of the
 * edited node must not be mounted again — that is what keeps its local state, its subscriptions and
 * whatever is typed into it — and the edited node keeps its element, with only its text changed.
 */
import { render } from '@solidjs/testing-library';
import { solidReactivity } from '@we/reactivity-solid';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { ensureNodeIds } from '@we/schema-shared';
import { type ComponentRegistry, RenderSchema } from '@we/schema-solid';
import { describe, expect, it } from 'vitest';

import { solidLiveTemplates } from '../src/frameworks/solid/stores/liveTemplate';
import { createTestPlatform } from '../src/shared/platform/testPlatform';
import { createEditorStore } from '../src/shared/stores/EditorStore';
import { createEditTarget } from '../src/shared/stores/editTarget';
import { createTemplateDrafts } from '../src/shared/templateDrafts';
import { deepClone } from '../src/shared/utils';

const mounts: Record<string, number> = {};
const registry: ComponentRegistry = {
  Box: (props: any) => <div data-testid={props.testid}>{props.children}</div>,
  Text: (props: any) => {
    mounts[props.testid] = (mounts[props.testid] ?? 0) + 1;
    return <span data-testid={props.testid}>{props.children}</span>;
  },
};

const page = (title: string): TemplateSchema =>
  ({
    schemaVersion: 1,
    id: 'mine',
    type: 'Box',
    meta: { name: 'Mine', description: '', icon: 'cube' },
    props: { testid: 'page' },
    children: [
      { id: 'title', type: 'Text', props: { testid: 'title' }, children: [title] },
      { id: 'sibling', type: 'Text', props: { testid: 'sibling' }, children: ['Untouched'] },
    ],
  }) as TemplateSchema;

describe('an edit in the editor, drawn by Solid', () => {
  it('redraws the edited node in place and leaves its sibling mounted', () => {
    const { reactivity } = { reactivity: solidReactivity };
    let editor!: ReturnType<typeof createEditorStore>;
    let edit!: ReturnType<typeof createEditTarget>;
    const dispose = reactivity.root(() => {
      const live = solidLiveTemplates(page('Before'));
      const templateStore = {
        get currentTemplate() {
          return live.read();
        },
        // As the template store does: a copy, keeping the ids of the nodes it replaces.
        updateTemplate: (next: TemplateSchema) => {
          const clone = deepClone(next) as SchemaNode;
          ensureNodeIds(clone, undefined, live.read());
          live.update(clone as TemplateSchema);
        },
        ...createTemplateDrafts({ reactivity, liveTemplates: solidLiveTemplates }),
        persistTemplate: async () => {},
        isBuiltInTemplateId: () => false,
        getTemplateRecord: () => undefined,
        provideEditingProbe: () => {},
        allTemplates: () => [],
        appTemplate: () => page('App'),
        appTemplateId: () => 'app',
        setAppTemplate: async () => true,
        saveTemplateAs: async () => true,
        storedAt: () => undefined,
        writtenElsewhere: (() => {}) as never,
      };
      edit = createEditTarget({ reactivity, templateStore });
      const quiet = () => undefined;
      editor = createEditorStore({
        reactivity,
        platform: createTestPlatform(),
        toasts: { info: quiet, success: quiet, warning: quiet, error: quiet },
        firstScreen: { open: () => false },
        sessionStore: { backendPorts: () => null as never },
        datasetStore: { currentDataset: () => null, currentDatasetEntities: () => [], rootDataset: () => null },
        shapeStore: { spaceShapes: () => [] },
        templateStore,
        themeStore: {
          editingTheme: () => null,
          currentThemeId: () => '',
          registerHistoryCallbacks: () => {},
          applySnapshot: async () => {},
          startEditing: () => {},
          cancelEditing: () => {},
        },
        editTarget: edit,
      });
    });

    const view = render(() => <RenderSchema node={edit.template()} stores={{}} registry={registry} />);
    const title = view.getByTestId('title');
    const sibling = view.getByTestId('sibling');
    expect(mounts).toEqual({ title: 1, sibling: 1 });

    // The code panel's path: the whole template typed back, one text changed.
    editor.onSchemaEdit(JSON.stringify(page('After')));

    expect(view.getByTestId('title').textContent).toBe('After');
    expect(view.getByTestId('title')).toBe(title);
    expect(view.getByTestId('sibling')).toBe(sibling);
    expect(mounts).toEqual({ title: 1, sibling: 1 });

    view.unmount();
    dispose();
  });
});
