import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { createContext, useContext } from 'solid-js';

/**
 * What the editor needs from whatever application is hosting it.
 *
 * This is the seam that makes the editor embeddable. Everything here was previously reached by
 * calling `useAiStore()` / `useTemplateStore()` / … directly — Solid context lookups into WE's shell,
 * which meant the editor could only ever run inside WE. Declared as a port instead, the editor
 * depends on a *shape*, and an application supplies it from whatever it already has: WE forwards its
 * stores, a third-party app forwards its own state, a test forwards plain signals.
 *
 * The surface is large because the editor genuinely drives a lot — it is an authoring tool, not a
 * widget. It is also honest: this is precisely the list an adopting application must satisfy, and
 * nothing is hidden behind an ambient import.
 *
 * Accessors are functions rather than values throughout, so the host chooses its own reactivity. WE
 * passes Solid accessors; nothing here names Solid's types.
 */

/** A theme as the editor sees it. Structural, so a host is not required to use WE's own type. */
export interface EditorTheme {
  id: string;
  name: string;
  icon?: string;
  origin?: string;
  /** Serialised on the wire — the editor parses, so a host stores whatever it already stores. */
  css?: string | null;
  overrides?: string | null;
  slug?: string;
  version?: number;
  description?: string;
  [key: string]: unknown;
}

export type EditorEditingTheme = EditorTheme & { isDirty: boolean };

/**
 * Templates: the working copy, the catalogue, and persistence.
 *
 * Member names mirror WE's `templateStore` exactly, so the adapter that satisfies this port is a
 * structural pass-through rather than a translation layer. That is deliberate at this stage — the
 * point of the port is to break the dependency, and a rename on top of that would make the same
 * change twice as hard to review. Names can narrow when state migrates into the editor.
 */
export interface TemplatePort {
  currentTemplate: TemplateSchema & { id?: string; version?: number; slug?: string };
  switcherGroups: () => { label: string; items: { id: string; name: string; icon?: string }[] }[];
  updateTemplate: (next: TemplateSchema) => void;
  switchTemplate: (id: string) => void;
  persistCurrentTemplate: () => Promise<unknown>;
  publishToSpace: (perspectiveUuid: string, spaceName: string) => Promise<boolean>;
  operationLoading: () => string | null;
  installFromMarketplace: (templateId: string) => Promise<void>;
  deleteMarketplaceTemplate: (templateId: string) => Promise<void>;
  publishToMarketplace: (options: PublishOptions) => Promise<unknown>;
}

/**
 * Themes: the catalogue, the active selection, and the theme-editing session.
 *
 * The `editing*` members are session state living on the host side of the port — a theme being
 * edited belongs to the editing session, not the catalogue. They are here because they currently
 * live in WE's `themeStore`; migrating them changes the adapter and nothing in the editor.
 */
export interface ThemePort {
  allThemes: () => EditorTheme[];
  builtInThemes: () => EditorTheme[];
  installedThemes: () => EditorTheme[];
  spaceThemes: () => EditorTheme[];
  currentTheme: () => EditorTheme;
  currentThemeId: () => string;
  setCurrentTheme: (themeId: string) => void;

  editingTheme: () => EditorEditingTheme | null;
  startEditing: (themeId?: string) => void;
  /**
   * The role the panel should reveal, kebab-case, or empty.
   *
   * `startEditing` opens the editor; this says what you came for. The inspector's role readout is
   * the caller that needs it — its whole gesture is "this colour is wrong, take me to it", and
   * landing at the top of a panel of forty roles is a worse answer than not offering the jump.
   */
  focusedRole: () => string;
  focusRole: (role: string) => void;
  createAndStartEditing: (
    name: string,
    icon: string,
    sourceThemeId?: string,
    destination?: string,
  ) => Promise<boolean> | boolean;
  changeBasePreset: (preset: string | undefined) => void;
  updateEditingOverrides: (overrides: Record<string, unknown>) => void;
  updateEditingCssRaw?: (css: string) => void;
  updateEditingCss: (css: string) => void;
  updateEditingMeta: (fields: { name?: string; icon?: string }) => void;
  saveEditingTheme: () => Promise<EditorTheme | null>;
  themeScope: () => 'global' | 'scoped';
  /** The agent's persisted choice, which a preview temporarily masks. */
  themeScopePreference: () => 'global' | 'scoped';
  /** Preview a scope for this editing session only; null returns to the preference. */
  previewThemeScope: (scope: 'global' | 'scoped' | null) => void;
  publishToSpace: (perspectiveUuid: string, spaceName: string) => Promise<boolean>;
  publishToMarketplace: (options: PublishOptions) => Promise<unknown>;
}

/**
 * The editing session — which mode the surface is in, and the panel geometry.
 *
 * Named `session` rather than `ai` because that is what it is. The store WE implements this from is
 * called `AiStore` for historical reasons, but panel modes, selection, undo/redo and the working
 * schema are the editing session; AI chat is one feature that reads them.
 */
export interface SessionPort {
  // Mode
  isEditingTemplate: () => boolean;
  isEditingTheme: () => boolean;
  editAction: () => 'edit' | 'fork' | 'fresh' | null;
  enterTemplateEditing: (action?: 'edit' | 'fork' | 'fresh') => void;
  exitTemplateEditing: () => void;
  enterThemeEditing: () => void;
  exitThemeEditing: () => void;
  toggleThemeEditing: () => void;

  // The working schema, and the history over it
  contentMode: () => 'preview' | 'visual';
  setContentMode: (mode: 'preview' | 'visual') => void;
  schemaJson: () => string;
  onSchemaEdit: (json: string) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  pushSnapshot: () => void;

  // The template being worked on
  templateName: () => string;
  templateIcon: () => string;
  isReadOnly: () => boolean;
  hasPendingChanges: () => boolean;
  startFork: () => void;
  startFresh: () => void;
  pickerOpen: () => boolean;
  pickerAction: () => 'fork' | 'fresh';
  pickerDefaultName: () => string;
  pickerDefaultIcon: () => string;
  pickerShowDestination: () => boolean;
  confirmPicker: (name: string, icon: string, destination: 'personal' | 'space') => Promise<void>;
  cancelPicker: () => void;

  // Panel geometry
  isOpen: () => boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  codePanelOpen: () => boolean;
  toggleCodePanel: () => void;
  openCodePanel: () => void;
  closeCodePanel: () => void;
  themePanelOpen: () => boolean;
  toggleThemePanel: () => void;
  openThemePanel: () => void;
  closeThemePanel: () => void;
  visualPanelOpen: () => boolean;
  toggleVisualPanel: () => void;

  // AI chat. Read by `@we/editor/ai` only — listed here because the session is one object today, and
  // this is the slice that moves behind its own port when the assistant grows past template editing.
  messages: () => EditorChatMessage[];
  isStreaming: () => boolean;
  streamingContent: () => string;
  apiKeyConfigured: () => boolean;
  setApiKey: (key: string) => void;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
  sessions: () => { id: string; name: string }[];
  activeSessionId: () => string | null;
  newChat: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
}

/** Who the user is, and which dataset the editor is working against. */
export interface EditorIdentityPort {
  me: () => { did?: string } | undefined;
  currentPerspective: () => unknown;
  orderedSidebarItems: () => { uuid: string; name: string; avatar?: string; spaceId: string }[];
  marketplaceJoined: () => boolean;
  spaceDefaultTemplateId: () => string;
  spaceDefaultThemeId: () => string;
  /** Profiles the host has cached, and a way to ask it to fetch one it hasn't. */
  agents: () => EditorAgentProfile[];
  fetchAgent: (did: string) => void | Promise<void>;
}

/** An author profile as the editor renders it. Structural — the host's own shape passes. */
export interface EditorAgentProfile {
  did: string;
  firstName?: string;
  lastName?: string;
  handle?: string;
  avatar?: string;
}

/** Publishing metadata, shared by templates and themes. */
export interface PublishOptions {
  name: string;
  description: string;
  icon?: string;
  slug?: string;
  themeId?: string;
  [key: string]: unknown;
}

/**
 * Images the editor can browse and upload — the background picker.
 *
 * A port rather than a direct model import: browsing "images already in this space" and "store this
 * file, give me a URL" are host concerns, and reaching for `ImageBlock` directly would have made the
 * editor AD4M-coupled for a picker.
 */
export interface EditorImage {
  id: string;
  src: string;
  altText?: string;
}

export interface EditorImagePort {
  list: (limit?: number) => Promise<EditorImage[]>;
  upload: (file: File) => Promise<string>;
}

export interface EditorHost {
  template: TemplatePort;
  theme: ThemePort;
  session: SessionPort;
  identity: EditorIdentityPort;
  images?: EditorImagePort;
  /** Registry the code and inspector panels resolve component metadata through. */
  registry?: Record<string, unknown>;
  /** Named schema fragments a host makes placeable, for the inspector's value pickers. */
  fragments?: () => Record<string, SchemaNode>;
}

const EditorHostContext = createContext<EditorHost>();

export const EditorHostProvider = EditorHostContext.Provider;

export function useEditorHost(): EditorHost {
  const host = useContext(EditorHostContext);
  if (!host) throw new Error('useEditorHost must be used within an EditorHostProvider');
  return host;
}

/** A chat message as the AI panel renders it. Structural, so a host supplies its own record type. */
export interface EditorChatMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}
