/**
 * Schema Mutation Actions
 *
 * Runtime mutation functions for testing the updateSchema diffing engine.
 * Split from SchemaMutations.schema.ts so the schema file remains a pure
 * data export that the validation CLI can load without runtime dependencies.
 */
import { toastService } from '@we/components/solid';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
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
function getMutationsRoot(schema: SchemaNode): SchemaNode {
  return schema.routes?.find((r) => r.path === '/mutations') ?? schema;
}

type SchemaChild = NonNullable<SchemaNode['children']>[number];

function isNode(child: SchemaChild | undefined): child is SchemaNode {
  return typeof child === 'object' && 'type' in child;
}

/**
 * The node reached by following child indices down from `node`. The harness wrote this tree
 * itself (see the path reference above), so anything other than a node on the way means that
 * layout changed and the mutation no longer knows where it is.
 */
function nodeAt(node: SchemaNode, ...path: number[]): SchemaNode {
  let current = node;
  for (const index of path) {
    const next = current.children?.[index];
    if (!isNode(next)) throw new Error(`Mutations schema has no node at children[${path.join('][')}]`);
    current = next;
  }
  return current;
}

/** A node's children array, created when absent, so a mutation can push into or reorder it. */
function childrenOf(node: SchemaNode): SchemaChild[] {
  return (node.children ??= []);
}

/** A node's props object, created when absent, so a mutation can read and set props on it. */
function propsOf(node: SchemaNode): NonNullable<SchemaNode['props']> {
  return (node.props ??= {});
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
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicChildren = childrenOf(nodeAt(root, 0, 4, 1));
    const count = dynamicChildren.length;
    dynamicChildren.push({
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
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicChildren = childrenOf(nodeAt(root, 0, 4, 1));
    if (dynamicChildren.length > 0) {
      dynamicChildren.pop();
    }
    applyUpdate(newSchema);
  }

  function changeProp() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicProps = propsOf(nodeAt(root, 0, 4));
    // Toggle background between neutral-0 and neutral-900
    dynamicProps.bg = dynamicProps.bg === 'neutral-0' ? 'neutral-900' : 'neutral-0';
    applyUpdate(newSchema);
  }

  function changeType() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicArea = nodeAt(root, 0, 4, 1);
    // Toggle between Column and Row
    dynamicArea.type = dynamicArea.type === 'Column' ? 'Row' : 'Column';
    applyUpdate(newSchema);
  }

  function addRouteChild() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const homeRoute = root.routes?.find((r) => r.path === '/');
    if (homeRoute) {
      const homeChildren = childrenOf(homeRoute);
      const count = homeChildren.length;
      homeChildren.push({
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
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicChildren = childrenOf(nodeAt(root, 0, 4, 1));
    if (dynamicChildren.length >= 2) {
      const midIndex = Math.floor(dynamicChildren.length / 2);
      dynamicChildren.splice(midIndex, 1);
    } else if (dynamicChildren.length === 1) {
      dynamicChildren.splice(0, 1);
    }
    applyUpdate(newSchema);
  }

  function reorderChildren() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicChildren = childrenOf(nodeAt(root, 0, 4, 1));
    if (dynamicChildren.length >= 2) {
      const first = dynamicChildren[0];
      const last = dynamicChildren[dynamicChildren.length - 1];
      dynamicChildren[0] = last;
      dynamicChildren[dynamicChildren.length - 1] = first;
    }
    applyUpdate(newSchema);
  }

  function deepNestedProp() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const firstChild = nodeAt(root, 0, 4, 1).children?.[0];
    if (isNode(firstChild)) {
      const icon = firstChild.children?.[0];
      if (isNode(icon) && icon.props?.color) {
        icon.props.color = icon.props.color === 'success-500' ? 'danger-500' : 'success-500';
      }
      const textNode = firstChild.children?.[1];
      if (isNode(textNode)) {
        textNode.children = [`Modified at ${Date.now() % 10000}`];
      }
    }
    applyUpdate(newSchema);
  }

  function multiMutate() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicArea = nodeAt(root, 0, 4);
    const innerColumn = nodeAt(dynamicArea, 1);
    const innerChildren = childrenOf(innerColumn);

    const count = innerChildren.length;
    innerChildren.push({
      type: 'Row',
      props: { p: '300', gap: '200', bg: 'accent-soft', r: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'lightning', color: 'accent' } },
        { type: 'we-text', children: [`Multi-mutate child #${count}`] },
      ],
    });

    const dynamicProps = propsOf(dynamicArea);
    dynamicProps.bg = dynamicProps.bg === 'neutral-0' ? 'accent-50' : 'neutral-0';
    innerColumn.type = innerColumn.type === 'Column' ? 'Row' : 'Column';

    applyUpdate(newSchema);
  }

  function noopMutate() {
    const newSchema = deepClone(currentSchema);
    const result = updateSchema(currentSchema, newSchema, setCurrentSchema);
    if (result.applied) {
      toastService.success('No-op: schema unchanged (0 mutations)');
    }
  }

  function changeText() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const placeholderChildren = childrenOf(nodeAt(root, 0, 4, 0));
    const current = placeholderChildren[0];
    placeholderChildren[0] =
      current === 'Dynamic children appear here. Click "Add child" above.'
        ? 'Text has been changed! Click again to revert.'
        : 'Dynamic children appear here. Click "Add child" above.';
    applyUpdate(newSchema);
  }

  function addProp() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicProps = propsOf(nodeAt(root, 0, 4));
    if (!dynamicProps.border) {
      dynamicProps.border = '2px solid var(--we-color-accent-300)';
    } else {
      dynamicProps.border =
        dynamicProps.border === '2px solid var(--we-color-accent-300)'
          ? '2px dashed var(--we-color-danger-300)'
          : '2px solid var(--we-color-accent-300)';
    }
    applyUpdate(newSchema);
  }

  function removeProp() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicProps = propsOf(nodeAt(root, 0, 4));
    if (dynamicProps.border) {
      delete dynamicProps.border;
    } else if (dynamicProps.r) {
      delete dynamicProps.r;
    }
    applyUpdate(newSchema);
  }

  function toggleTheme() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    const dynamicArea = nodeAt(root, 0, 4);
    if (dynamicArea.theme) {
      delete dynamicArea.theme;
    } else {
      dynamicArea.theme = { accentHue: 312, saturation: 80 };
    }
    applyUpdate(newSchema);
  }

  function invalidMutate() {
    const newSchema = deepClone(currentSchema);
    const root = getMutationsRoot(newSchema);
    childrenOf(nodeAt(root, 0, 4, 1)).push({
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
