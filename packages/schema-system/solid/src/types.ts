import type { JSX } from 'solid-js';

import type {
  ComponentRegistry as SharedComponentRegistry,
  RendererOutput as SharedRendererOutput,
  RenderProps as SharedRenderProps,
} from '../../shared/types';

export type { SchemaNode } from '../../shared/types';

export type ComponentRegistry = SharedComponentRegistry<JSX.Element>;
export type RenderProps = SharedRenderProps<JSX.Element>;
export type RendererOutput = SharedRendererOutput<JSX.Element>;
