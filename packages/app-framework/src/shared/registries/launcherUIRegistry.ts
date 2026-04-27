/**
 * Launcher UI Registry
 *
 * Holds the schemas for the persistent shell chrome components.
 * The bootScreen can be overridden via seed.host.ui for white-labeling.
 */

import { aiChatSidebar } from '@shared/schemas/shell/AiChatSidebar.schema';
import { bootScreen } from '@shared/schemas/shell/BootScreen.schema';
import { sidebar } from '@shared/schemas/shell/Sidebar.schema';
import type { SchemaNode } from '@we/schema-shared';

export const launcherUIRegistry = {
  /** Boot/login screen shown before AD4M is ready */
  bootScreen: bootScreen as SchemaNode,

  /** Persistent sidebar — always mounted alongside templates */
  shell: sidebar as SchemaNode,

  /** AI chat sidebar panel */
  aiChatSidebar: aiChatSidebar as SchemaNode,
};

export type LauncherUIRegistry = typeof launcherUIRegistry;
