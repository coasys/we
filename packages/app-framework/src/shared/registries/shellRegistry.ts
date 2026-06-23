/**
 * Shell Registry
 *
 * Named slots for the persistent shell chrome. Each entry is independently
 * overridable — seeds can swap out individual slots (e.g. white-label the
 * boot screen, or strip the template editor entirely by setting it to null).
 */

import { bootScreen } from '@shared/schemas/shell/BootScreen.schema';
import { sidebar } from '@shared/schemas/shell/Sidebar.schema';
import { templateEditor } from '@shared/schemas/shell/TemplateEditor.schema';
import type { SchemaNode } from '@we/schema-shared';

export const shellRegistry = {
  /** Full-screen boot/login overlay, shown before AD4M is ready */
  bootScreen: bootScreen as SchemaNode,

  /** Persistent left sidebar — always mounted alongside templates */
  sidebar: sidebar as SchemaNode,

  /** Template editing chrome — right panel + toolbar. Override with null to disable. */
  templateEditor: templateEditor as SchemaNode,
};

export type ShellRegistry = typeof shellRegistry;
