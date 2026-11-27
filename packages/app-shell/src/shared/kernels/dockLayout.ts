/**
 * The dock layout: what a second host needs to lay panels out the way WE does. Data in, data out: a
 * host implements these against the recorded vectors beside this file (`vectors/dockLayout.json`) or
 * runs them as they are.
 *
 * These are the entry points — each answers one whole question the shell asks, about every panel at
 * once or about one moment of a drag — and not the helpers they are built from. The functions live in
 * `../dockGeometry.ts`, beside the reasoning for each; the rest of that file (how an edge is grouped
 * into lanes and seats, one panel's box, a lane's division, the snap origins, the slot lines) is how
 * WE happens to compute these answers, tested in TypeScript and free to change shape without the
 * vectors changing. A host that reaches the same answers another way conforms.
 *
 * Everything here measures against the app's frame (the bands its chrome holds), which rides on the
 * viewport each function is given (`Viewport.frame`), so an answer depends on its arguments alone and
 * a vector names its frame among them.
 *
 * What is not here is what a host reads from its own screen: which panels are registered and what
 * each asks for, how recently each was touched, where a lane's section or a template's outlet is
 * drawn. The shell store reads those and hands them in.
 */
export {
  // Where one panel is placed: the reader's disposition, the interface's declaration, the panel's
  // own bid — fitted to its content where it asks, and written back as a declaration.
  arrangedPanel,
  fitPlacement,
  resolvePlacement,
  // The seated layout: how every lane divides and who shows, every panel's box, the lanes the host
  // draws at the edges, what the content gives up and the chrome clears, and how each panel is framed.
  contentInset,
  coveredInset,
  edgeLaneLayout,
  laneSectionsOf,
  panelFramesOf,
  railBand,
  resolveDocks,
  seatLanes,
  withChromeCovered,
  // During a drag: what the carried panel clears, every panel's box as a rectangle where the host has
  // drawn nothing to measure, the snaps and slots it is offered, which of them the pointer means.
  chooseTarget,
  edgeDropSlots,
  homeDropSlots,
  occupiedById,
  rectOf,
  snapBeatsSlot,
  snapCandidate,
  snapTargetRects,
  stackCandidates,
  stackDropSlots,
  takenSnapsOf,
  // What a drop writes: the edge or home lane renumbered, the seat a snap takes, a panel leaving its
  // lane, and the seat-mates that follow it.
  arrangeDrop,
  arrangeHomeDrop,
  edgeSeatOrder,
  followSeat,
  seatSize,
  unlaned,
  // Gestures: a resize, the boundary between two seats, a panel pulled off what it was attached to.
  liftedCard,
  movedBoundary,
  resizedBox,
} from '../dockGeometry';
