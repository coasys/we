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
 * Rebuild with `pnpm --filter @we/entities generate:types`.
 */
import type { RecordInstance, WeNodeRecord } from './base';

export type { RecordInstance, WeNodeRecord };

export type SignalMode = 'toggle' | 'vote' | 'rating' | 'slider';
export type SignalAggregate = 'count' | 'mean' | 'sum' | 'median';
export type SignalSemantic = 'approval' | 'quality' | 'relevance' | 'agreement' | 'custom';

export interface AgentSettingsRecord extends RecordInstance {
  currentTemplateId: string;
  defaultTemplateId: string;
  currentThemeId: string;
  defaultThemeId: string;
  systemLightThemeId: string;
  systemDarkThemeId: string;
  claudeApiKey: string;
  datasetOrder: string;
  globalSpaceJoined: boolean;
  globalSpaceUrl: string;
  useSpaceTemplate: boolean;
  useTemplateTheme: boolean;
  themeScope: string;
  installedModules: string;
  moduleSettings: string;
  installedTemplates: TemplateRecord[];
  installedThemes: ThemeRecord[];
  spaceTemplatePreferences: SpaceTemplatePreferenceRecord[];
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

export interface AudioBlockRecord extends WeNodeRecord {
  title: string;
  artist: string;
  audioUrl: string;
  duration: number;
  albumArt: string;
  version: number;
}

export interface CalloutBlockRecord extends WeNodeRecord {
  text: string;
  variant: string;
  icon: string;
  version: number;
}

export interface CallExtractionRecord extends WeNodeRecord {
  callId: string;
  entities: string;
}

export interface ChatMessageRecord extends WeNodeRecord {
  role: string;
  content: string;
}

export interface ChatSessionRecord extends WeNodeRecord {
  name: string;
  templateId: string;
  messages: ChatMessageRecord[];
  addMessages(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeMessages(value: string | { id: string }, batch?: string): Promise<unknown>;
  setMessages(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface CodeBlockRecord extends WeNodeRecord {
  code: string;
  language: string;
  title: string;
  version: number;
}

export interface CollectionBlockRecord extends WeNodeRecord {
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

export interface DividerBlockRecord extends WeNodeRecord {
  style: string;
  version: number;
}

export interface EmbedBlockRecord extends WeNodeRecord {
  url: string;
  target: string;
  targetType: string;
  label: string;
  thumbnail: string;
  displayMode: string;
  version: number;
}

export interface EventBlockRecord extends WeNodeRecord {
  occurrence: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  allDay: boolean;
  version: number;
}

export interface FileBlockRecord extends WeNodeRecord {
  title: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  version: number;
}

export interface ImageBlockRecord extends WeNodeRecord {
  src: string;
  altText: string;
  width: number;
  height: number;
  version: number;
}

export interface LinkBlockRecord extends WeNodeRecord {
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  version: number;
}

export interface LocationBlockRecord extends WeNodeRecord {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  city?: string;
  countryCode?: string;
  country?: string;
  version: number;
}

export interface MutedAgentRecord extends WeNodeRecord {
  did: string;
  description: string;
}

export interface PlacementRecord extends RecordInstance {
  nodeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contentScale: number;
  color: string;
  cardShape: string;
  node?: string;
}

export interface ReadMarkerRecord extends WeNodeRecord {
  nodeId: string;
  spaceUuid: string;
  lastReadAt: string;
}

export interface RelationshipRecord extends WeNodeRecord {
  connection: string;
  relationshipTypeId: string;
  label: string;
  description: string;
  sourceType: string;
  targetType: string;
  source?: string;
  target?: string;
}

export interface RelationshipTypeRecord extends WeNodeRecord {
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  inverseName: string;
  directed: boolean;
  schemaVersion: number;
}

export interface ShapeRecord extends WeNodeRecord {
  name: string;
  description: string;
  icon: string;
  shapeId: string;
  version: number;
  forkedFrom: string;
  definition: string | null;
}

export interface SignalRecord extends RecordInstance {
  signalTypeId: string;
  value: number;
}

export interface SignalTypeRecord extends WeNodeRecord {
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
  retired: boolean;
  valueType: string;
  schemaVersion: number;
}

export interface SpaceRecord extends WeNodeRecord {
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
  enabledViews: string;
  extractionTargets: string;
  autoInterpret: boolean;
  moduleSettings: string;
  shareExtractionDetail: boolean;
  location?: LocationBlockRecord;
  setLocation(value: LocationBlockRecord): Promise<unknown>;
}

export interface SpacePreferenceRecord extends WeNodeRecord {
  spaceUuid: string;
  mutedModules: string;
  moduleSettings: string;
  hiddenViews: string;
  templateId: string;
  themeId: string;
}

export interface SpaceTemplatePreferenceRecord extends WeNodeRecord {
  spaceUrl: string;
  preference: string;
}

export interface TagBlockRecord extends WeNodeRecord {
  name: string;
  color: string;
  version: number;
}

export interface TaskBlockRecord extends WeNodeRecord {
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  assignee: string;
  version: number;
}

export interface TemplateRecord extends WeNodeRecord {
  name: string;
  description: string;
  icon: string;
  origin: string;
  version: number;
  slug: string;
  schema: string | null;
  themeId: string;
  role: string;
  screenshots: string[];
  addScreenshots(value: string | { id: string }, batch?: string): Promise<unknown>;
  removeScreenshots(value: string | { id: string }, batch?: string): Promise<unknown>;
  setScreenshots(values: (string | { id: string })[], batch?: string): Promise<unknown>;
}

export interface TextBlockRecord extends WeNodeRecord {
  style: string;
  listItem: string;
  level: number;
  checked: boolean;
  align: string;
  direction: string;
  text: string;
  marks: string;
  version: number;
}

export interface TopicRecord extends WeNodeRecord {
  name: string;
  description: string;
  icon: string;
  color: string;
}

export interface ThemeRecord extends WeNodeRecord {
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

export interface TypeStyleRecord extends RecordInstance {
  nodeType: string;
  color: string;
}

export interface VideoBlockRecord extends WeNodeRecord {
  title: string;
  url: string;
  duration: number;
  thumbnail: string;
  provider: string;
  version: number;
}
