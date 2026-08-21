/**
 * Schema Mutation Actions
 *
 * Runtime mutation functions for testing the updateSchema diffing engine.
 * Split from SchemaMutations.schema.ts so the schema file remains a pure
 * data export that the validation CLI can load without runtime dependencies.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { toastService } from '@we/components/solid';
import type { TemplateSchema } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import type { SetStoreFunction } from 'solid-js/store';

import { deepClone } from '../../../utils';

// ---------------------------------------------------------------------------
// Mutation functions
//
// Path reference (within mutations root):
//   children[0] = mainContent Column
//     children[0] = header
//     children[1] = mutation buttons Row (primary)
//     children[2] = mutation buttons Row 2 (secondary)
//     children[3] = mutation buttons Row 3 (outline)
//     children[4] = dynamic area Column
//       children[0] = placeholder text
//       children[1] = inner Column (dynamic children go here)
//     children[5] = route area Column (with $routes)
//
// When running as a sub-route of SchemaTests, the mutations content lives
// inside routes[].find(r => r.path === '/mutations'). getMutationsRoot()
// navigates to the correct subtree.
// ---------------------------------------------------------------------------

/** Get the mutations schema root — handles both standalone and nested-route scenarios */
function getMutationsRoot(schema: any): any {
  return schema.routes?.find((r: any) => r.path === '/mutations') ?? schema;
}

export function schemaMutationActions(
  currentSchema: TemplateSchema,
  setCurrentSchema: SetStoreFunction<TemplateSchema>,
) {
  function applyUpdate(newSchema: TemplateSchema) {
    const result = updateSchema(currentSchema, newSchema, setCurrentSchema);
    if (!result.applied && result.errors?.length) {
      toastService.error(`Schema validation failed: ${result.errors[0].message}`);
    }
  }

  function addChild() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4].children[1];
    const count = dynamicArea.children.length;
    dynamicArea.children.push({
      type: 'Row',
      props: { p: '300', gap: '200', bg: 'surface-sunken', r: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'check', color: 'success-text' } },
        { type: 'we-text', children: [`Template child #${count}`] },
      ],
    });
    applyUpdate(newSchema);
  }

  function removeChild() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4].children[1];
    if (dynamicArea.children.length > 0) {
      dynamicArea.children.pop();
    }
    applyUpdate(newSchema);
  }

  function changeProp() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4];
    // Toggle background between neutral-0 and neutral-900
    dynamicArea.props.bg = dynamicArea.props.bg === 'neutral-0' ? 'neutral-900' : 'neutral-0';
    applyUpdate(newSchema);
  }

  function changeType() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4].children[1];
    // Toggle between Column and Row
    dynamicArea.type = dynamicArea.type === 'Column' ? 'Row' : 'Column';
    applyUpdate(newSchema);
  }

  function addRouteChild() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const homeRoute = root.routes?.find((r: any) => r.path === '/');
    if (homeRoute) {
      const count = homeRoute.children.length;
      homeRoute.children.push({
        type: 'Row',
        props: { p: '300', gap: '200', bg: 'surface-sunken', r: '200', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'check', color: 'accent' } },
          { type: 'we-text', children: [`Route child #${count}`] },
        ],
      });
    }
    applyUpdate(newSchema);
  }

  function removeFromMiddle() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4].children[1];
    if (dynamicArea.children.length >= 2) {
      const midIndex = Math.floor(dynamicArea.children.length / 2);
      dynamicArea.children.splice(midIndex, 1);
    } else if (dynamicArea.children.length === 1) {
      dynamicArea.children.splice(0, 1);
    }
    applyUpdate(newSchema);
  }

  function reorderChildren() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4].children[1];
    if (dynamicArea.children.length >= 2) {
      const first = dynamicArea.children[0];
      const last = dynamicArea.children[dynamicArea.children.length - 1];
      dynamicArea.children[0] = last;
      dynamicArea.children[dynamicArea.children.length - 1] = first;
    }
    applyUpdate(newSchema);
  }

  function deepNestedProp() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4].children[1];
    if (dynamicArea.children.length > 0) {
      const firstChild = dynamicArea.children[0];
      if (firstChild.children?.[0]?.props?.color) {
        firstChild.children[0].props.color =
          firstChild.children[0].props.color === 'success-500' ? 'danger-500' : 'success-500';
      }
      if (firstChild.children?.[1]) {
        const textNode = firstChild.children[1];
        textNode.children = [`Modified at ${Date.now() % 10000}`];
      }
    }
    applyUpdate(newSchema);
  }

  function multiMutate() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const mainContent = root.children[0];
    const dynamicArea = mainContent.children[4];
    const innerColumn = dynamicArea.children[1];

    const count = innerColumn.children.length;
    innerColumn.children.push({
      type: 'Row',
      props: { p: '300', gap: '200', bg: 'accent-muted', r: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'lightning', color: 'accent' } },
        { type: 'we-text', children: [`Multi-mutate child #${count}`] },
      ],
    });

    dynamicArea.props.bg = dynamicArea.props.bg === 'neutral-0' ? 'primary-50' : 'neutral-0';
    innerColumn.type = innerColumn.type === 'Column' ? 'Row' : 'Column';

    applyUpdate(newSchema);
  }

  function noopMutate() {
    const newSchema = deepClone(currentSchema) as any;
    const result = updateSchema(currentSchema, newSchema, setCurrentSchema);
    if (result.applied) {
      toastService.success('No-op: schema unchanged (0 mutations)');
    }
  }

  function changeText() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4];
    const placeholder = dynamicArea.children[0];
    const current = placeholder.children[0];
    placeholder.children[0] =
      current === 'Dynamic children appear here. Click "Add child" above.'
        ? 'Text has been changed! Click again to revert.'
        : 'Dynamic children appear here. Click "Add child" above.';
    applyUpdate(newSchema);
  }

  function addProp() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4];
    if (!dynamicArea.props.border) {
      dynamicArea.props.border = '2px solid var(--we-color-primary-300)';
    } else {
      dynamicArea.props.border =
        dynamicArea.props.border === '2px solid var(--we-color-primary-300)'
          ? '2px dashed var(--we-color-danger-300)'
          : '2px solid var(--we-color-primary-300)';
    }
    applyUpdate(newSchema);
  }

  function removeProp() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4];
    if (dynamicArea.props.border) {
      delete dynamicArea.props.border;
    } else if (dynamicArea.props.r) {
      delete dynamicArea.props.r;
    }
    applyUpdate(newSchema);
  }

  function toggleTheme() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    const dynamicArea = root.children[0].children[4];
    if (dynamicArea.theme) {
      delete dynamicArea.theme;
    } else {
      dynamicArea.theme = { primaryHue: 280, saturation: '80%' };
    }
    applyUpdate(newSchema);
  }

  function invalidMutate() {
    const newSchema = deepClone(currentSchema) as any;
    const root = getMutationsRoot(newSchema);
    root.children[0].children[4].children[1].children.push({
      type: '$each',
      props: {},
      children: [],
    });
    applyUpdate(newSchema);
  }

  return {
    addChild,
    removeChild,
    changeProp,
    changeType,
    addRouteChild,
    removeFromMiddle,
    reorderChildren,
    deepNestedProp,
    multiMutate,
    noopMutate,
    changeText,
    addProp,
    removeProp,
    toggleTheme,
    invalidMutate,
  };
}
