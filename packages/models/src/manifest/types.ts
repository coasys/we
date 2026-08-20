/**
 * GENERATED from the manifest definitions — do not edit here.
 *
 * The neutral model contract: one interface per core entity, defining the fields any backend
 * must present for it. The AD4M lane's generated classes are held to these by the conformance
 * assertions beside them (@we/backend-ad4m src/models/conformance.ts); another backend's
 * implementations (runtime-compiled like backend-inmemory, or generated) are what these
 * interfaces exist to type. Fields and the accessor methods consumers call — query sugar is
 * backend ergonomics, not contract.
 *
 * Rebuild with `pnpm --filter @we/models generate:types`.
 */
import type { ModelInstance, WeNodeModel } from './base';

export type { ModelInstance, WeNodeModel };

export type SignalMode = 'toggle' | 'vote' | 'rating' | 'slider';
export type SignalAggregate = 'count' | 'mean' | 'sum' | 'median';
export type SignalSemantic = 'approval' | 'quality' | 'relevance' | 'agreement' | 'custom';

export interface AgentSettingsModel extends ModelInstance {
  currentTemplateId: string;
  defaultTemplateId: string;
  currentThemeId: string;
  defaultThemeId: string;
  claudeApiKey: string;
  datasetOrder: string;
  globalSpaceJoined: boolean;
  globalSpaceUrl: string;
  useSpaceTemplate: boolean;
  useTemplateTheme: boolean;
  themeScope: string;
  installedModules: string;
  installedTemplates: TemplateModel[];
  installedThemes: ThemeModel[];
  spaceTemplatePreferences: SpaceTemplatePreferenceModel[];
  addInstalledTemplates(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeInstalledTemplates(value: string | { id: string }, batch?: string): Promise<unknown>;
  setInstalledTemplates(values: (string | { id: string })[], batch?: string): Promise<unknown>;
  addInstalledThemes(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeInstalledThemes(value: string | { id: string }, batch?: string): Promise<unknown>;
  setInstalledThemes(values: (string | { id: string })[], batch?: string): Promise<unknown>;
  addSpaceTemplatePreferences(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeSpaceTemplatePreferences(value: string | { id: string }, batch?: string): Promise<unknown>;
  setSpaceTemplatePreferences(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface AudioBlockModel extends WeNodeModel {
  title: string;
  artist: string;
  audioUrl: string;
  duration: number;
  albumArt: string;
  version: number;
}

export interface CalloutBlockModel extends WeNodeModel {
  text: string;
  variant: string;
  icon: string;
  version: number;
}

export interface ChatMessageModel extends WeNodeModel {
  role: string;
  content: string;
}

export interface ChatSessionModel extends WeNodeModel {
  name: string;
  templateId: string;
  messages: ChatMessageModel[];
  addMessages(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeMessages(value: string | { id: string }, batch?: string): Promise<unknown>;
  setMessages(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface CodeBlockModel extends WeNodeModel {
  code: string;
  language: string;
  title: string;
  version: number;
}

export interface CollectionBlockModel extends WeNodeModel {
  editorState: string | null;
  type: string;
  kind: string;
  mode: string;
  title: string;
  description: string;
  version: number;
  textContent: string;
  children: string[];
  addChildren(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeChildren(value: string | { id: string }, batch?: string): Promise<unknown>;
  setChildren(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface DividerBlockModel extends WeNodeModel {
  style: string;
  version: number;
}

export interface EmbedBlockModel extends WeNodeModel {
  url: string;
  target: string;
  targetType: string;
  displayMode: string;
  version: number;
}

export interface EventBlockModel extends WeNodeModel {
  occurrence: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  allDay: boolean;
  version: number;
}

export interface FileBlockModel extends WeNodeModel {
  title: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  version: number;
}

export interface ImageBlockModel extends WeNodeModel {
  src: string;
  altText: string;
  width: number;
  height: number;
  version: number;
}

export interface LinkBlockModel extends WeNodeModel {
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  version: number;
}

export interface LocationBlockModel extends WeNodeModel {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  city?: string;
  countryCode?: string;
  country?: string;
  version: number;
}

export interface MutedAgentModel extends WeNodeModel {
  did: string;
  description: string;
}

export interface ReadMarkerModel extends WeNodeModel {
  nodeId: string;
  spaceUuid: string;
  lastReadAt: string;
}

export interface ShapeModel extends WeNodeModel {
  name: string;
  description: string;
  icon: string;
  shapeId: string;
  version: number;
  forkedFrom: string;
  definition: string | null;
}

export interface SignalModel extends ModelInstance {
  signalTypeId: string;
  value: number;
}

export interface SignalTypeModel extends WeNodeModel {
  name: string;
  slug: string;
  description: string;
  icon: string;
  iconSecondary: string;
  step: number;
  rangeMin: number;
  rangeMax: number;
  mode: 'toggle' | 'vote' | 'rating' | 'slider';
  aggregate: 'count' | 'mean' | 'sum' | 'median';
  semantic: 'approval' | 'quality' | 'relevance' | 'agreement' | 'custom';
  allowChange: boolean;
  valueType: string;
  schemaVersion: number;
}

export interface SpaceModel extends WeNodeModel {
  uuid: string;
  url?: string;
  name: string;
  description: string;
  discovery: string;
  avatar?: string;
  coverImage?: string;
  defaultTemplateId: string;
  defaultThemeId: string;
  enabledModules: string;
  autoInterpret: boolean;
  location?: LocationBlockModel;
  setLocation(value: LocationBlockModel): Promise<unknown>;
}

export interface SpacePreferenceModel extends WeNodeModel {
  spaceUuid: string;
  mutedModules: string;
  templateId: string;
  themeId: string;
}

export interface SpaceTemplatePreferenceModel extends WeNodeModel {
  spaceUrl: string;
  preference: string;
}

export interface TagBlockModel extends WeNodeModel {
  name: string;
  color: string;
  version: number;
}

export interface TaskBlockModel extends WeNodeModel {
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  assignee: string;
  version: number;
}

export interface TemplateModel extends WeNodeModel {
  name: string;
  description: string;
  icon: string;
  origin: string;
  version: number;
  slug: string;
  schema: string | null;
  themeId: string;
  screenshots: string[];
  addScreenshots(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeScreenshots(value: string | { id: string }, batch?: string): Promise<unknown>;
  setScreenshots(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface TextBlockModel extends WeNodeModel {
  type: string;
  direction: string;
  format: string;
  indent: number;
  textFormat: number;
  textStyle: string;
  listType: string;
  start: number;
  tag: string;
  text: string;
  version: number;
}

export interface ThemeModel extends WeNodeModel {
  name: string;
  description: string;
  icon: string;
  origin: string;
  slug: string;
  version: number;
  css: string | null;
  overrides: string | null;
  screenshots: string[];
  addScreenshots(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeScreenshots(value: string | { id: string }, batch?: string): Promise<unknown>;
  setScreenshots(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface VideoBlockModel extends WeNodeModel {
  title: string;
  url: string;
  duration: number;
  thumbnail: string;
  provider: string;
  version: number;
}
