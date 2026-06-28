import { Ad4mModel, PerspectiveProxy } from '@coasys/ad4m';
import {
  AgentSettings,
  AudioBlock,
  CalloutBlock,
  ChatMessage,
  ChatSession,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  Signal,
  SignalType,
  Space,
  SpaceTemplatePreference,
  TagBlock,
  TaskBlock,
  Template,
  TextBlock,
  Theme,
  VideoBlock,
  WeNode,
} from '@we/models';

/**
 * All SDNA models that belong to the we-root system perspective.
 * Centralised here so both AdamStore branches (create vs restore) always
 * register the same complete set.
 */
export const ROOT_MODELS = [
  AgentSettings,
  ChatMessage,
  ChatSession,
  SpaceTemplatePreference,
  Template,
  Theme,
  LocationBlock,
] as const;

/**
 * Registers all root SDNA models on the given perspective.
 * `register()` is idempotent — safe to call multiple times or on perspectives
 * that already have some models registered.
 */
export async function installRootSdna(p: PerspectiveProxy): Promise<void> {
  await Ad4mModel.registerAll(p, [...ROOT_MODELS]);
}

/**
 * All SDNA models that belong to a WE space perspective.
 * Centralised here so both SpaceStore and AdamStore can reference the same
 * list without creating a circular dependency.
 */
export const SPACE_MODELS = [
  Space,
  Template,
  Theme,
  WeNode,
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
  Signal,
  SignalType,
  TagBlock,
  TaskBlock,
  TextBlock,
  VideoBlock,
] as const;

/**
 * Registers all space SDNA models on the given perspective.
 * `register()` is idempotent — safe to call multiple times or on perspectives
 * that already have some models registered.
 */
export async function installSpaceSdna(p: PerspectiveProxy): Promise<void> {
  await Ad4mModel.registerAll(p, [...SPACE_MODELS]);
}
