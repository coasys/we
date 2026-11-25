/**
 * The dock layout: what a second host needs to lay panels out the way WE does — where a panel lands
 * and how big it is, how an edge's lanes and seats divide it, what a fold, a strip, full screen and a
 * drag do to that, and which targets a drop is offered. Data in, data out: a host implements these
 * against the recorded vectors beside this file (`vectors/dockLayout.json`) or runs them as they are.
 *
 * The functions live in `../dockGeometry.ts`, beside the reasoning for each; this file is the list of
 * which of them are the contract. The rest of that file is helpers these call, constants, and types.
 * Everything here measures against the app's frame (the bands its chrome holds), which the shell sets
 * with `setGeometryFrame` when the app template changes — so each vector names the frame it was
 * recorded under, and a host replaying one sets it first.
 *
 * What is not here is what a host reads from its own screen: which panels are registered and what
 * each asks for, how recently each was touched, where a lane's section or a template's outlet is
 * drawn. The shell store reads those and hands them in.
 */
export {
  // Where one panel lands, and how big it is.
  arrangedPanel,
  canFold,
  displaces,
  dockThickness,
  edgeOfSnap,
  fitPlacement,
  floorOf,
  liftedCard,
  placementFromDeclaration,
  rectOf,
  resizedBox,
  resolveDock,
  seedPlacement,
  snapOrigin,
  thicknessOf,
  // How an edge is divided: lanes, seats, and who shows.
  columnLayout,
  columnMembers,
  edgeGroups,
  frontOf,
  laneable,
  laneBase,
  laneSectionsOf,
  laneShrunk,
  laneThickness,
  layerOrder,
  looseSeats,
  movedBoundary,
  roomElsewhere,
  seatLanes,
  seatsOf,
  widestMin,
  // Every panel at once, and what the content gives up.
  contentInset,
  coveredInset,
  coveringLanes,
  displacingLanes,
  edgeLaneBox,
  edgeLaneLayout,
  occupiedById,
  occupiedFor,
  panelFramesOf,
  railBand,
  resolveDocks,
  stripBox,
  withChromeCovered,
  // Joining, leaving and following a seat.
  followSeat,
  seatOrder,
  seatSize,
  unlaned,
  // Where a drop lands, and the targets it is offered.
  arrangeDrop,
  arrangeHomeDrop,
  chooseTarget,
  columnSlots,
  edgeDropSlots,
  edgeSeatOrder,
  edgeZone,
  grown,
  homeDropSlots,
  homeLaneMembers,
  insertionSlots,
  nearEdge,
  overlapArea,
  snapBeatsSlot,
  snapCandidate,
  snapTargetRects,
  snapTargetSize,
  stackCandidates,
  stackDropSlots,
  takenSnaps,
  takenSnapsOf,
} from '../dockGeometry';
