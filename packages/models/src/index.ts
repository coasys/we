/**
 * WE's entity vocabulary.
 *
 * Each entity below is exported twice over: as a *type* (its instance shape) and as a *value*
 * that stands in for whichever backend implementation is registered — see entityProxy.ts. A
 * consumer writes `Space.findAll(dataset, …)` and never names a backend; the AD4M adapter
 * registers decorated classes at connect time, and another backend registers its own.
 *
 * The implementations live in each backend's own package — the AD4M classes in
 * `@we/backend-ad4m/src/models`, generated from this package's manifest — and are registered here
 * at connect time. Nothing outside a backend adapter can even name them.
 *
 * Both exports are typed by the NEUTRAL contract — the generated interfaces in
 * `manifest/types.ts` and the `ModelStatic` surface from `@we/backend-shared` — not by the AD4M
 * classes. That is the point of the flip: what a consumer can rely on is what the manifest
 * declares, conformance holds the AD4M lane to it, and this package's `@coasys` edge stops being
 * part of its public face.
 */
import type { ModelStatic } from '@we/backend-shared';

import { defineEntity } from './entityProxy';
import type * as M from './manifest/types';

export type WeNode = M.WeNodeModel;
export const WeNode = defineEntity('WeNode') as unknown as ModelStatic<M.WeNodeModel>;
export type AgentSettings = M.AgentSettingsModel;
export const AgentSettings = defineEntity('AgentSettings') as unknown as ModelStatic<M.AgentSettingsModel>;
export type ChatMessage = M.ChatMessageModel;
export const ChatMessage = defineEntity('ChatMessage') as unknown as ModelStatic<M.ChatMessageModel>;
export type ChatSession = M.ChatSessionModel;
export const ChatSession = defineEntity('ChatSession') as unknown as ModelStatic<M.ChatSessionModel>;
export type MutedAgent = M.MutedAgentModel;
export const MutedAgent = defineEntity('MutedAgent') as unknown as ModelStatic<M.MutedAgentModel>;
export type Placement = M.PlacementModel;
export const Placement = defineEntity('Placement') as unknown as ModelStatic<M.PlacementModel>;
export type ReadMarker = M.ReadMarkerModel;
export const ReadMarker = defineEntity('ReadMarker') as unknown as ModelStatic<M.ReadMarkerModel>;
export type Relationship = M.RelationshipModel;
export const Relationship = defineEntity('Relationship') as unknown as ModelStatic<M.RelationshipModel>;
export type RelationshipType = M.RelationshipTypeModel;
export const RelationshipType = defineEntity('RelationshipType') as unknown as ModelStatic<M.RelationshipTypeModel>;
export type Signal = M.SignalModel;
export const Signal = defineEntity('Signal') as unknown as ModelStatic<M.SignalModel>;
export type SignalType = M.SignalTypeModel;
export const SignalType = defineEntity('SignalType') as unknown as ModelStatic<M.SignalTypeModel>;
export type Space = M.SpaceModel;
export const Space = defineEntity('Space') as unknown as ModelStatic<M.SpaceModel>;
export { AGENT_DEFAULT, FOLLOW_SPACE } from './manifest/entities/SpacePreference';
export type SpacePreference = M.SpacePreferenceModel;
export const SpacePreference = defineEntity('SpacePreference') as unknown as ModelStatic<M.SpacePreferenceModel>;
export type SpaceTemplatePreference = M.SpaceTemplatePreferenceModel;
export const SpaceTemplatePreference = defineEntity(
  'SpaceTemplatePreference',
) as unknown as ModelStatic<M.SpaceTemplatePreferenceModel>;
export type Shape = M.ShapeModel;
export const Shape = defineEntity('Shape') as unknown as ModelStatic<M.ShapeModel>;
export type Template = M.TemplateModel;
export const Template = defineEntity('Template') as unknown as ModelStatic<M.TemplateModel>;
export type Theme = M.ThemeModel;
export const Theme = defineEntity('Theme') as unknown as ModelStatic<M.ThemeModel>;
export type TypeStyle = M.TypeStyleModel;
export const TypeStyle = defineEntity('TypeStyle') as unknown as ModelStatic<M.TypeStyleModel>;
export { modelToThemeData } from './utils/themeData';
export type { ThemeData, ThemeLike } from './utils/themeData';
export type { SignalAggregate, SignalMode, SignalSemantic } from './manifest/types';
export type AudioBlock = M.AudioBlockModel;
export const AudioBlock = defineEntity('AudioBlock') as unknown as ModelStatic<M.AudioBlockModel>;
export type CalloutBlock = M.CalloutBlockModel;
export const CalloutBlock = defineEntity('CalloutBlock') as unknown as ModelStatic<M.CalloutBlockModel>;
export type CodeBlock = M.CodeBlockModel;
export const CodeBlock = defineEntity('CodeBlock') as unknown as ModelStatic<M.CodeBlockModel>;
export type CollectionBlock = M.CollectionBlockModel;
export const CollectionBlock = defineEntity('CollectionBlock') as unknown as ModelStatic<M.CollectionBlockModel>;
export type DividerBlock = M.DividerBlockModel;
export const DividerBlock = defineEntity('DividerBlock') as unknown as ModelStatic<M.DividerBlockModel>;
export type EmbedBlock = M.EmbedBlockModel;
export const EmbedBlock = defineEntity('EmbedBlock') as unknown as ModelStatic<M.EmbedBlockModel>;
export type EventBlock = M.EventBlockModel;
export const EventBlock = defineEntity('EventBlock') as unknown as ModelStatic<M.EventBlockModel>;
export type FileBlock = M.FileBlockModel;
export const FileBlock = defineEntity('FileBlock') as unknown as ModelStatic<M.FileBlockModel>;
export type ImageBlock = M.ImageBlockModel;
export const ImageBlock = defineEntity('ImageBlock') as unknown as ModelStatic<M.ImageBlockModel>;
export type LinkBlock = M.LinkBlockModel;
export const LinkBlock = defineEntity('LinkBlock') as unknown as ModelStatic<M.LinkBlockModel>;
export type LocationBlock = M.LocationBlockModel;
export const LocationBlock = defineEntity('LocationBlock') as unknown as ModelStatic<M.LocationBlockModel>;
export type TagBlock = M.TagBlockModel;
export const TagBlock = defineEntity('TagBlock') as unknown as ModelStatic<M.TagBlockModel>;
export type TaskBlock = M.TaskBlockModel;
export const TaskBlock = defineEntity('TaskBlock') as unknown as ModelStatic<M.TaskBlockModel>;
export type TextBlock = M.TextBlockModel;
export const TextBlock = defineEntity('TextBlock') as unknown as ModelStatic<M.TextBlockModel>;
export type VideoBlock = M.VideoBlockModel;
export const VideoBlock = defineEntity('VideoBlock') as unknown as ModelStatic<M.VideoBlockModel>;
export { FILE_STORAGE_LANGUAGE, PREDICATES } from './constants';
export {
  asFileField,
  dataURItoBlob,
  blobToDataURL,
  resizeImage,
  compressImageToFileData,
  shrinkDataUri,
  dataURIToFileData,
  readFileAsFileData,
} from './utils/imageHelpers';
export type { FileData } from './utils/imageHelpers';
export { normalizeSignal, denormalizeSignal } from './utils/signalNormalize';
export { aggregateSignals } from './utils/signalAggregate';
export { decodeFileAsString, decodeFileAsJson, encodeJsonFileData } from './utils/fileTransforms';

/**
 * The dataset handle model statics accept — opaque on purpose. Which kind of handle "a dataset"
 * is (an AD4M PerspectiveProxy, an in-memory store, a connection) is the connected backend's
 * business; consumers hold one and pass it along. This used to alias PerspectiveProxy, which was
 * the last `@coasys` edge on this package's public face.
 */
export type DatasetProxy = unknown;
export * from './modelRegistry';
