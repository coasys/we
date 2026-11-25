/**
 * The app's one instance of each piece of host state the shared modules describe but cannot hold: a
 * module of their own is neutral only if it makes no signal at import, so each is a factory over the
 * reactivity port, and this is where the app makes its copy, over Solid's.
 *
 * Read by the components and stores that draw from them. A store that moves to the port takes the one
 * it needs as an argument at `BootController` instead of importing it from here.
 */
import { solidReactivity } from '@we/reactivity-solid';

import { createBoardOptimism } from '../../shared/boardOptimism';
import { createInvolvementOptimism } from '../../shared/involvementOptimism';
import { createPretendPeople } from '../../shared/pretendPeople';
import { createAppFrame } from '../../shared/registries/appFrame';
import { createLaneFrames } from '../../shared/registries/homeLanes';
import { createPanelInstances } from '../../shared/registries/panelInstances';
import { createSignalOptimism } from '../../shared/signalOptimism';
import { createTaskWorkflowLive } from '../../shared/taskWorkflowLive';

/** Cards drawn where they were dropped, ahead of the data. See `shared/boardOptimism.ts`. */
export const boardOptimism = createBoardOptimism(solidReactivity.signal);
/** People put on or taken off a record, ahead of the data. See `shared/involvementOptimism.ts`. */
export const involvementOptimism = createInvolvementOptimism(solidReactivity.signal);
/** Reactions drawn ahead of the data. See `shared/signalOptimism.ts`. */
export const signalOptimism = createSignalOptimism(solidReactivity.signal);
/** The space's task workflow as the board draws it. See `shared/taskWorkflowLive.ts`. */
export const taskWorkflowLive = createTaskWorkflowLive(solidReactivity.signal);

export const { appFrame, declareAppFrame, appEdgeFrames, declareAppEdges } = createAppFrame(solidReactivity);
export const { declareLaneFrame, laneFrames } = createLaneFrames(solidReactivity);
export const { panelInstances, publishPanelInstances } = createPanelInstances(solidReactivity);
export const { pretendPeople, pretendSettings, actingAs, setPretendCount, actAs, answerAs, forgetPretendAnswers } =
  createPretendPeople(solidReactivity);

/** What the shell store reads and publishes of the host state above — see `ShellHostState`. */
export const shellHost = { appFrame, appEdgeFrames, laneFrames, publishPanelInstances };
