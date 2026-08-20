import type { ModelManifest } from '@we/backend-shared';

import { AudioBlock } from './blocks/AudioBlock';
import { CalloutBlock } from './blocks/CalloutBlock';
import { CodeBlock } from './blocks/CodeBlock';
import { CollectionBlock } from './blocks/CollectionBlock';
import { DividerBlock } from './blocks/DividerBlock';
import { EmbedBlock } from './blocks/EmbedBlock';
import { EventBlock } from './blocks/EventBlock';
import { FileBlock } from './blocks/FileBlock';
import { ImageBlock } from './blocks/ImageBlock';
import { LinkBlock } from './blocks/LinkBlock';
import { LocationBlock } from './blocks/LocationBlock';
import { TagBlock } from './blocks/TagBlock';
import { TaskBlock } from './blocks/TaskBlock';
import { TextBlock } from './blocks/TextBlock';
import { VideoBlock } from './blocks/VideoBlock';
import type { CoreEntityDef } from './defs';

// The neutral contract, on the package's public surface. The conformance assertions that hold the
// AD4M lane to it live beside that lane's generated classes (@we/backend-ad4m src/models).
export * from './types';
import { AgentSettings } from './entities/AgentSettings';
import { ChatMessage } from './entities/ChatMessage';
import { ChatSession } from './entities/ChatSession';
import { MutedAgent } from './entities/MutedAgent';
import { ReadMarker } from './entities/ReadMarker';
import { Shape } from './entities/Shape';
import { Signal } from './entities/Signal';
import { SignalType } from './entities/SignalType';
import { Space } from './entities/Space';
import { SpacePreference } from './entities/SpacePreference';
import { SpaceTemplatePreference } from './entities/SpaceTemplatePreference';
import { Template } from './entities/Template';
import { Theme } from './entities/Theme';
import { WE_NODE_ENTITY, WE_NODE_RELATIONS } from './shared';

export { WE_NODE_ENTITY, WE_NODE_RELATIONS };

/**
 * Every core definition, in the order the manifest publishes them. This file is the assembly
 * point and nothing else: each entity is authored in its own module under `entities/` or
 * `blocks/`, and `scripts/generateClasses.mjs` turns these same definitions into the decorated
 * AD4M classes — the manifest is the source of truth, the classes are its artifact.
 */
export const CORE_DEFS: Record<string, CoreEntityDef> = {
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
  MutedAgent,
  ReadMarker,
  Shape,
  Signal,
  SignalType,
  Space,
  SpacePreference,
  SpaceTemplatePreference,
  TagBlock,
  TaskBlock,
  Template,
  TextBlock,
  Theme,
  VideoBlock,
};

/** A WeNode-based entity inherits the shared relations; its own come first, as declared. */
function assemble(def: CoreEntityDef) {
  if (def.base !== 'WeNode') return def.entity;
  return { ...def.entity, relations: { ...def.entity.relations, ...WE_NODE_RELATIONS } };
}

export const CORE_MANIFEST: ModelManifest = {
  version: '1',
  entities: {
    ...Object.fromEntries(Object.entries(CORE_DEFS).map(([name, def]) => [name, assemble(def)])),
    WeNode: WE_NODE_ENTITY,
  },
};
