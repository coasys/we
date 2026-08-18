/**
 * WE's entity vocabulary.
 *
 * Each entity below is exported twice over: as a *type* (its instance shape) and as a *value*
 * that stands in for whichever backend implementation is registered — see entityProxy.ts. A
 * consumer writes `Space.findAll(dataset, …)` and never names a backend; the AD4M adapter
 * registers decorated classes at connect time, and another backend registers its own.
 *
 * The implementations themselves live behind `@we/models/classes`, which only a backend adapter
 * should import.
 */
import type * as C from './classes';
import { defineEntity } from './entityProxy';

export type WeNode = C.WeNode;
export const WeNode = defineEntity('WeNode') as unknown as typeof C.WeNode;
export type AgentSettings = C.AgentSettings;
export const AgentSettings = defineEntity('AgentSettings') as unknown as typeof C.AgentSettings;
export type ChatMessage = C.ChatMessage;
export const ChatMessage = defineEntity('ChatMessage') as unknown as typeof C.ChatMessage;
export type ChatSession = C.ChatSession;
export const ChatSession = defineEntity('ChatSession') as unknown as typeof C.ChatSession;
export type MutedAgent = C.MutedAgent;
export const MutedAgent = defineEntity('MutedAgent') as unknown as typeof C.MutedAgent;
export type ReadMarker = C.ReadMarker;
export const ReadMarker = defineEntity('ReadMarker') as unknown as typeof C.ReadMarker;
export type Signal = C.Signal;
export const Signal = defineEntity('Signal') as unknown as typeof C.Signal;
export type SignalType = C.SignalType;
export const SignalType = defineEntity('SignalType') as unknown as typeof C.SignalType;
export type Space = C.Space;
export const Space = defineEntity('Space') as unknown as typeof C.Space;
export { AGENT_DEFAULT, FOLLOW_SPACE } from './entities';
export type SpacePreference = C.SpacePreference;
export const SpacePreference = defineEntity('SpacePreference') as unknown as typeof C.SpacePreference;
export type SpaceTemplatePreference = C.SpaceTemplatePreference;
export const SpaceTemplatePreference = defineEntity(
  'SpaceTemplatePreference',
) as unknown as typeof C.SpaceTemplatePreference;
export type Shape = C.Shape;
export const Shape = defineEntity('Shape') as unknown as typeof C.Shape;
export type Template = C.Template;
export const Template = defineEntity('Template') as unknown as typeof C.Template;
export type Theme = C.Theme;
export const Theme = defineEntity('Theme') as unknown as typeof C.Theme;
export { modelToThemeData } from './utils/themeData';
export type { ThemeData, ThemeLike } from './utils/themeData';
export type { SignalMode, SignalAggregate, SignalSemantic } from './entities';
export type AudioBlock = C.AudioBlock;
export const AudioBlock = defineEntity('AudioBlock') as unknown as typeof C.AudioBlock;
export type CalloutBlock = C.CalloutBlock;
export const CalloutBlock = defineEntity('CalloutBlock') as unknown as typeof C.CalloutBlock;
export type CodeBlock = C.CodeBlock;
export const CodeBlock = defineEntity('CodeBlock') as unknown as typeof C.CodeBlock;
export type CollectionBlock = C.CollectionBlock;
export const CollectionBlock = defineEntity('CollectionBlock') as unknown as typeof C.CollectionBlock;
export type DividerBlock = C.DividerBlock;
export const DividerBlock = defineEntity('DividerBlock') as unknown as typeof C.DividerBlock;
export type EmbedBlock = C.EmbedBlock;
export const EmbedBlock = defineEntity('EmbedBlock') as unknown as typeof C.EmbedBlock;
export type EventBlock = C.EventBlock;
export const EventBlock = defineEntity('EventBlock') as unknown as typeof C.EventBlock;
export type FileBlock = C.FileBlock;
export const FileBlock = defineEntity('FileBlock') as unknown as typeof C.FileBlock;
export type ImageBlock = C.ImageBlock;
export const ImageBlock = defineEntity('ImageBlock') as unknown as typeof C.ImageBlock;
export type LinkBlock = C.LinkBlock;
export const LinkBlock = defineEntity('LinkBlock') as unknown as typeof C.LinkBlock;
export type LocationBlock = C.LocationBlock;
export const LocationBlock = defineEntity('LocationBlock') as unknown as typeof C.LocationBlock;
export type TagBlock = C.TagBlock;
export const TagBlock = defineEntity('TagBlock') as unknown as typeof C.TagBlock;
export type TaskBlock = C.TaskBlock;
export const TaskBlock = defineEntity('TaskBlock') as unknown as typeof C.TaskBlock;
export type TextBlock = C.TextBlock;
export const TextBlock = defineEntity('TextBlock') as unknown as typeof C.TextBlock;
export type VideoBlock = C.VideoBlock;
export const VideoBlock = defineEntity('VideoBlock') as unknown as typeof C.VideoBlock;
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

// The model layer's dataset type — what every generated model's static methods accept. Re-exported
// under a neutral name so the app shell can type dataset handles without importing the backend SDK
// directly (@coasys imports are confined to this package, backend-ad4m, and ad4m-declaring modules).
export type { PerspectiveProxy as DatasetProxy } from '@coasys/ad4m';
export type { Ad4mModel } from '@coasys/ad4m';
export * from './modelRegistry';
