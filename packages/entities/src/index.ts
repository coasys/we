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
 * `manifest/types.ts` and the `EntityStatic` surface from `@we/backend-shared` — not by the AD4M
 * classes. That is the point of the flip: what a consumer can rely on is what the manifest
 * declares, conformance holds the AD4M lane to it, and this package's `@coasys` edge stops being
 * part of its public face.
 */
import type { EntityStatic } from '@we/backend-shared';

import { defineEntity } from './entityProxy';
import type * as M from './manifest/types';

export type WeNode = M.WeNodeRecord;
export const WeNode = defineEntity('WeNode') as unknown as EntityStatic<M.WeNodeRecord>;
export type AgentSettings = M.AgentSettingsRecord;
export const AgentSettings = defineEntity('AgentSettings') as unknown as EntityStatic<M.AgentSettingsRecord>;
export type CallExtraction = M.CallExtractionRecord;
export const CallExtraction = defineEntity('CallExtraction') as unknown as EntityStatic<M.CallExtractionRecord>;
export type ChatMessage = M.ChatMessageRecord;
export const ChatMessage = defineEntity('ChatMessage') as unknown as EntityStatic<M.ChatMessageRecord>;
export type ChatSession = M.ChatSessionRecord;
export const ChatSession = defineEntity('ChatSession') as unknown as EntityStatic<M.ChatSessionRecord>;
export type MutedAgent = M.MutedAgentRecord;
export const MutedAgent = defineEntity('MutedAgent') as unknown as EntityStatic<M.MutedAgentRecord>;
export type Placement = M.PlacementRecord;
export const Placement = defineEntity('Placement') as unknown as EntityStatic<M.PlacementRecord>;
export type ReadMarker = M.ReadMarkerRecord;
export const ReadMarker = defineEntity('ReadMarker') as unknown as EntityStatic<M.ReadMarkerRecord>;
export type Relationship = M.RelationshipRecord;
export const Relationship = defineEntity('Relationship') as unknown as EntityStatic<M.RelationshipRecord>;
export type RelationshipType = M.RelationshipTypeRecord;
export const RelationshipType = defineEntity('RelationshipType') as unknown as EntityStatic<M.RelationshipTypeRecord>;
export type Signal = M.SignalRecord;
export const Signal = defineEntity('Signal') as unknown as EntityStatic<M.SignalRecord>;
export type SignalType = M.SignalTypeRecord;
export const SignalType = defineEntity('SignalType') as unknown as EntityStatic<M.SignalTypeRecord>;
export type Space = M.SpaceRecord;
export const Space = defineEntity('Space') as unknown as EntityStatic<M.SpaceRecord>;
export { AGENT_DEFAULT, FOLLOW_SPACE } from './manifest/SpacePreference';
export type SpacePreference = M.SpacePreferenceRecord;
export const SpacePreference = defineEntity('SpacePreference') as unknown as EntityStatic<M.SpacePreferenceRecord>;
export type SpaceTemplatePreference = M.SpaceTemplatePreferenceRecord;
export const SpaceTemplatePreference = defineEntity(
  'SpaceTemplatePreference',
) as unknown as EntityStatic<M.SpaceTemplatePreferenceRecord>;
export type Shape = M.ShapeRecord;
export const Shape = defineEntity('Shape') as unknown as EntityStatic<M.ShapeRecord>;
export type Template = M.TemplateRecord;
export const Template = defineEntity('Template') as unknown as EntityStatic<M.TemplateRecord>;
export type Theme = M.ThemeRecord;
export const Theme = defineEntity('Theme') as unknown as EntityStatic<M.ThemeRecord>;
export type TypeStyle = M.TypeStyleRecord;
export const TypeStyle = defineEntity('TypeStyle') as unknown as EntityStatic<M.TypeStyleRecord>;
export { modelToThemeData } from './utils/themeData';
export type { ThemeData, ThemeLike } from './utils/themeData';
export type { SignalAggregate, SignalMode, SignalSemantic } from './manifest/types';
export type AudioBlock = M.AudioBlockRecord;
export const AudioBlock = defineEntity('AudioBlock') as unknown as EntityStatic<M.AudioBlockRecord>;
export type CalloutBlock = M.CalloutBlockRecord;
export const CalloutBlock = defineEntity('CalloutBlock') as unknown as EntityStatic<M.CalloutBlockRecord>;
export type CodeBlock = M.CodeBlockRecord;
export const CodeBlock = defineEntity('CodeBlock') as unknown as EntityStatic<M.CodeBlockRecord>;
export type CollectionBlock = M.CollectionBlockRecord;
export const CollectionBlock = defineEntity('CollectionBlock') as unknown as EntityStatic<M.CollectionBlockRecord>;
export type DividerBlock = M.DividerBlockRecord;
export const DividerBlock = defineEntity('DividerBlock') as unknown as EntityStatic<M.DividerBlockRecord>;
export type EmbedBlock = M.EmbedBlockRecord;
export const EmbedBlock = defineEntity('EmbedBlock') as unknown as EntityStatic<M.EmbedBlockRecord>;
export type EventBlock = M.EventBlockRecord;
export const EventBlock = defineEntity('EventBlock') as unknown as EntityStatic<M.EventBlockRecord>;
export type FileBlock = M.FileBlockRecord;
export const FileBlock = defineEntity('FileBlock') as unknown as EntityStatic<M.FileBlockRecord>;
export type ImageBlock = M.ImageBlockRecord;
export const ImageBlock = defineEntity('ImageBlock') as unknown as EntityStatic<M.ImageBlockRecord>;
export type LinkBlock = M.LinkBlockRecord;
export const LinkBlock = defineEntity('LinkBlock') as unknown as EntityStatic<M.LinkBlockRecord>;
export type LocationBlock = M.LocationBlockRecord;
export const LocationBlock = defineEntity('LocationBlock') as unknown as EntityStatic<M.LocationBlockRecord>;
export type TagBlock = M.TagBlockRecord;
export const TagBlock = defineEntity('TagBlock') as unknown as EntityStatic<M.TagBlockRecord>;
export type TaskBlock = M.TaskBlockRecord;
export const TaskBlock = defineEntity('TaskBlock') as unknown as EntityStatic<M.TaskBlockRecord>;
export type TextBlock = M.TextBlockRecord;
export const TextBlock = defineEntity('TextBlock') as unknown as EntityStatic<M.TextBlockRecord>;
export type VideoBlock = M.VideoBlockRecord;
export const VideoBlock = defineEntity('VideoBlock') as unknown as EntityStatic<M.VideoBlockRecord>;
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
export * from './entityRegistry';
