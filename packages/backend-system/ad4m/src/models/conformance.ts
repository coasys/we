/**
 * GENERATED — the AD4M classes, held to the neutral contract.
 *
 * Type-level only: each assertion fails compilation when a generated class stops satisfying
 * its interface in types.ts, so the contract cannot drift from the one implementation that
 * ships. Reached from the manifest entry point as a type export, which is what places this
 * file in the build's type graph — an unimported assertion checks nothing.
 */
import type * as M from '@we/models/manifest';

import type * as C from './index';

type Satisfies<A extends B, B> = A;

/** One entry per entity; the tuple exists so every assertion is referenced. */
export type AssertClassesSatisfyContract = [
  Satisfies<InstanceType<typeof C.AgentSettings>, M.AgentSettingsModel>,
  Satisfies<InstanceType<typeof C.AudioBlock>, M.AudioBlockModel>,
  Satisfies<InstanceType<typeof C.CalloutBlock>, M.CalloutBlockModel>,
  Satisfies<InstanceType<typeof C.ChatMessage>, M.ChatMessageModel>,
  Satisfies<InstanceType<typeof C.ChatSession>, M.ChatSessionModel>,
  Satisfies<InstanceType<typeof C.CodeBlock>, M.CodeBlockModel>,
  Satisfies<InstanceType<typeof C.CollectionBlock>, M.CollectionBlockModel>,
  Satisfies<InstanceType<typeof C.DividerBlock>, M.DividerBlockModel>,
  Satisfies<InstanceType<typeof C.EmbedBlock>, M.EmbedBlockModel>,
  Satisfies<InstanceType<typeof C.EventBlock>, M.EventBlockModel>,
  Satisfies<InstanceType<typeof C.FileBlock>, M.FileBlockModel>,
  Satisfies<InstanceType<typeof C.ImageBlock>, M.ImageBlockModel>,
  Satisfies<InstanceType<typeof C.LinkBlock>, M.LinkBlockModel>,
  Satisfies<InstanceType<typeof C.LocationBlock>, M.LocationBlockModel>,
  Satisfies<InstanceType<typeof C.MutedAgent>, M.MutedAgentModel>,
  Satisfies<InstanceType<typeof C.ReadMarker>, M.ReadMarkerModel>,
  Satisfies<InstanceType<typeof C.Shape>, M.ShapeModel>,
  Satisfies<InstanceType<typeof C.Signal>, M.SignalModel>,
  Satisfies<InstanceType<typeof C.SignalType>, M.SignalTypeModel>,
  Satisfies<InstanceType<typeof C.Space>, M.SpaceModel>,
  Satisfies<InstanceType<typeof C.SpacePreference>, M.SpacePreferenceModel>,
  Satisfies<InstanceType<typeof C.SpaceTemplatePreference>, M.SpaceTemplatePreferenceModel>,
  Satisfies<InstanceType<typeof C.TagBlock>, M.TagBlockModel>,
  Satisfies<InstanceType<typeof C.TaskBlock>, M.TaskBlockModel>,
  Satisfies<InstanceType<typeof C.Template>, M.TemplateModel>,
  Satisfies<InstanceType<typeof C.TextBlock>, M.TextBlockModel>,
  Satisfies<InstanceType<typeof C.Theme>, M.ThemeModel>,
  Satisfies<InstanceType<typeof C.VideoBlock>, M.VideoBlockModel>,
];

/*
 * The STATIC surface (ModelStatic, what the entity proxies are typed as) is deliberately not
 * asserted here: the AD4M statics are `this`-polymorphic generics — `this: typeof Ad4mModel &
 * (new (…) => T)` — and a detached method carrying that constraint satisfies no interface
 * member, however compatible the call actually is. The guarantee is held at runtime instead:
 * the proxy binds `this` at call time, and every store call in the test suite exercises the
 * statics through the same proxies production uses.
 */
