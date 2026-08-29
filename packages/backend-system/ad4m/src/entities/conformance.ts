/**
 * GENERATED — the AD4M classes, held to the neutral contract.
 *
 * Type-level only: each assertion fails compilation when a generated class stops satisfying
 * its interface in types.ts, so the contract cannot drift from the one implementation that
 * ships. Reached from the manifest entry point as a type export, which is what places this
 * file in the build's type graph — an unimported assertion checks nothing.
 */
import type * as M from '@we/entities/manifest';

import type * as C from './index';

type Satisfies<A extends B, B> = A;

/** One entry per entity; the tuple exists so every assertion is referenced. */
export type AssertClassesSatisfyContract = [
  Satisfies<InstanceType<typeof C.AgentSettings>, M.AgentSettingsRecord>,
  Satisfies<InstanceType<typeof C.AudioBlock>, M.AudioBlockRecord>,
  Satisfies<InstanceType<typeof C.CalloutBlock>, M.CalloutBlockRecord>,
  Satisfies<InstanceType<typeof C.CallExtraction>, M.CallExtractionRecord>,
  Satisfies<InstanceType<typeof C.ChatMessage>, M.ChatMessageRecord>,
  Satisfies<InstanceType<typeof C.ChatSession>, M.ChatSessionRecord>,
  Satisfies<InstanceType<typeof C.CodeBlock>, M.CodeBlockRecord>,
  Satisfies<InstanceType<typeof C.CollectionBlock>, M.CollectionBlockRecord>,
  Satisfies<InstanceType<typeof C.DividerBlock>, M.DividerBlockRecord>,
  Satisfies<InstanceType<typeof C.EmbedBlock>, M.EmbedBlockRecord>,
  Satisfies<InstanceType<typeof C.EventBlock>, M.EventBlockRecord>,
  Satisfies<InstanceType<typeof C.FileBlock>, M.FileBlockRecord>,
  Satisfies<InstanceType<typeof C.ImageBlock>, M.ImageBlockRecord>,
  Satisfies<InstanceType<typeof C.LinkBlock>, M.LinkBlockRecord>,
  Satisfies<InstanceType<typeof C.LocationBlock>, M.LocationBlockRecord>,
  Satisfies<InstanceType<typeof C.MutedAgent>, M.MutedAgentRecord>,
  Satisfies<InstanceType<typeof C.Placement>, M.PlacementRecord>,
  Satisfies<InstanceType<typeof C.ReadMarker>, M.ReadMarkerRecord>,
  Satisfies<InstanceType<typeof C.Relationship>, M.RelationshipRecord>,
  Satisfies<InstanceType<typeof C.RelationshipType>, M.RelationshipTypeRecord>,
  Satisfies<InstanceType<typeof C.Shape>, M.ShapeRecord>,
  Satisfies<InstanceType<typeof C.Signal>, M.SignalRecord>,
  Satisfies<InstanceType<typeof C.SignalType>, M.SignalTypeRecord>,
  Satisfies<InstanceType<typeof C.Space>, M.SpaceRecord>,
  Satisfies<InstanceType<typeof C.SpacePreference>, M.SpacePreferenceRecord>,
  Satisfies<InstanceType<typeof C.SpaceTemplatePreference>, M.SpaceTemplatePreferenceRecord>,
  Satisfies<InstanceType<typeof C.TagBlock>, M.TagBlockRecord>,
  Satisfies<InstanceType<typeof C.TaskBlock>, M.TaskBlockRecord>,
  Satisfies<InstanceType<typeof C.Template>, M.TemplateRecord>,
  Satisfies<InstanceType<typeof C.TextBlock>, M.TextBlockRecord>,
  Satisfies<InstanceType<typeof C.Theme>, M.ThemeRecord>,
  Satisfies<InstanceType<typeof C.TypeStyle>, M.TypeStyleRecord>,
  Satisfies<InstanceType<typeof C.VideoBlock>, M.VideoBlockRecord>,
];

/*
 * The STATIC surface (EntityStatic, what the entity proxies are typed as) is deliberately not
 * asserted here: the AD4M statics are `this`-polymorphic generics — `this: typeof Ad4mModel &
 * (new (…) => T)` — and a detached method carrying that constraint satisfies no interface
 * member, however compatible the call actually is. The guarantee is held at runtime instead:
 * the proxy binds `this` at call time, and every store call in the test suite exercises the
 * statics through the same proxies production uses.
 */
