export { WeNode } from './WeNode';
export {
  AgentSettings,
  ChatMessage,
  ChatSession,
  Signal,
  SignalType,
  Space,
  SpaceTemplatePreference,
  Template,
  Theme,
} from './entities';
export type { ThemeData } from './entities/Theme';
export { modelToThemeData } from './entities/Theme';
export type { SignalMode, SignalAggregate, SignalSemantic } from './entities';
export {
  AudioBlock,
  CalloutBlock,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  TagBlock,
  TaskBlock,
  TextBlock,
  VideoBlock,
} from './blocks';
export { FILE_STORAGE_LANGUAGE } from './constants';
export {
  asFileField,
  dataURItoBlob,
  blobToDataURL,
  resizeImage,
  compressImageToFileData,
  dataURIToFileData,
  readFileAsFileData,
} from './utils/imageHelpers';
export type { FileData } from './utils/imageHelpers';
export { normalizeSignal, denormalizeSignal } from './utils/signalNormalize';
export { aggregateSignals } from './utils/signalAggregate';
export { decodeFileAsString, decodeFileAsJson } from './utils/fileTransforms';

// The model layer's dataset type — what every generated model's static methods accept. Re-exported
// under a neutral name so the app shell can type dataset handles without importing the backend SDK
// directly (@coasys imports are confined to this package, backend-ad4m, and ad4m-declaring modules).
export type { PerspectiveProxy as DatasetProxy } from '@coasys/ad4m';
export type { Ad4mModel } from '@coasys/ad4m';
