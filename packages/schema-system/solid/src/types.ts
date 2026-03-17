import type {
  ComponentRegistry as SharedComponentRegistry,
  RendererOutput as SharedRendererOutput,
  RenderProps as SharedRenderProps,
} from '@we/schema-shared';
import type { JSX } from 'solid-js';

export type { SchemaNode } from '@we/schema-shared';

export type ComponentRegistry = SharedComponentRegistry<JSX.Element>;
export type RenderProps = SharedRenderProps<JSX.Element>;
export type RendererOutput = SharedRendererOutput<JSX.Element>;
