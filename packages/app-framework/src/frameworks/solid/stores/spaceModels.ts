import { PerspectiveProxy } from '@coasys/ad4m';
import {
  AgentProfile,
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
  Space,
  TagBlock,
  TaskBlock,
  TextBlock,
  VideoBlock,
  WeNode,
} from '@we/models';

/**
 * All SDNA models that belong to a WE space perspective.
 * Centralised here so both SpaceStore and AdamStore can reference the same
 * list without creating a circular dependency.
 */
export const SPACE_MODELS = [
  AgentProfile,
  Space,
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
  await Promise.all(SPACE_MODELS.map((M) => M.register(p)));
}
