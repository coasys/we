/**
 * Store members outside every profile that already have a neutral equivalent, and what that is.
 *
 * Each is WE-host-only like every other member outside a profile, and the validator says so; for
 * these it also names what to write instead — a record read through the Space record or a `$query`,
 * a host value (`me`, `currentDataset`), `record.*`, or a declared operation (`ops.core.<name>`),
 * which every host provides. A member leaves this list when templates stop using it and it leaves
 * the surface; one gains an entry here when its neutral equivalent exists, not before, so the
 * validator never points at something that does not work yet.
 *
 * An operation takes its params as one object where the store action took positional arguments, so
 * moving a call is a rewrite of its `args`, not a rename.
 */
export const HOST_ONLY_EQUIVALENTS: Readonly<Record<string, string>> = {
  // Host values every template has.
  'datasetStore.currentDataset': 'currentDataset',

  // Reads of the space's own records.
  'spaceStore.root': 'spaceStore.currentSpace.root',
  'spaceStore.taskStates': "a $query of 'TaskState'",
  'spaceStore.offeredTaskStates': "a $query of 'TaskState' where retired is false",
  'spaceStore.involvementTypes': "a $query of 'InvolvementType'",
  'spaceStore.offeredInvolvementTypes': "a $query of 'InvolvementType' where retired is false",
  'spaceStore.roles': "a $query of 'Role', with 'RoleGrant' for its holders",
  'spaceStore.memberRoles': "a $query of 'RoleGrant'",
  'spaceStore.landmarks': "a $query of 'SpaceLandmark'",
  'spaceStore.landmarksLoaded': "local.<name>Loaded of the 'SpaceLandmark' $queries entry",
  'spaceStore.readMarkers': "a $query of 'ReadMarker' where author is me.did",
  'spaceStore.members': 'spaceStore.memberDids with profileStore.profiles, in an expression',
  'spaceStore.spaceList': 'spaceStore.mySpaces, arranged in an expression',
  'spaceStore.orderedSidebarItems': 'spaceStore.mySpaces, arranged in an expression',

  // Writes that are declared operations.
  'spaceStore.createPost': 'ops.core.createPost',
  'spaceStore.upsertSignal': 'ops.core.upsertSignal, and ops.core.withdrawSignal to take one back',
  'spaceStore.setInvolvement': 'ops.core.setInvolvement',
  'spaceStore.respondTo': 'ops.core.respond',
  'spaceStore.markRead': 'ops.core.markRead',
  'spaceStore.createBoard': 'ops.core.createBoard',
  'spaceStore.openBoardFor': 'ops.core.openBoardFor',
  'spaceStore.addBoardColumn': 'ops.core.addBoardColumn',
  'spaceStore.removeBoardColumn': 'ops.core.removeBoardColumn',
  'spaceStore.renameBoardColumn': 'ops.core.renameBoardColumn',
  'spaceStore.reorderBoardColumns': 'ops.core.reorderBoardColumns',
  'spaceStore.arrangeColumn': 'ops.core.arrangeColumn',
  'spaceStore.moveCardToColumn': 'ops.core.moveCard',
  'spaceStore.addTaskToColumn': 'ops.core.addTaskToColumn',
  'spaceStore.createSignalType': 'ops.core.createSignalType',
  'spaceStore.createTaskState': 'ops.core.createTaskState',
  'spaceStore.updateTaskState': 'ops.core.updateTaskState',
  'spaceStore.setTaskStateRetired': 'ops.core.setTaskStateRetired',
  'spaceStore.reorderTaskStates': 'ops.core.reorderTaskStates',
  'spaceStore.createInvolvementType': 'ops.core.createInvolvementType',
  'spaceStore.updateInvolvementType': 'ops.core.updateInvolvementType',
  'spaceStore.setInvolvementTypeRetired': 'ops.core.setInvolvementTypeRetired',
  'spaceStore.createRelationshipType': 'ops.core.createRelationshipType',
  'spaceStore.updateSpaceMeta': 'ops.core.updateSpaceMeta',
  'spaceStore.setModuleEnabled': 'ops.core.setModuleEnabled',
  'spaceStore.setViewEnabled': 'ops.core.setViewEnabled',
  'spaceStore.reorderViews': 'ops.core.reorderViews',
  'spaceStore.setSpaceModuleSetting': 'ops.core.setSpaceModuleSetting',
  'spaceStore.setWorkflowArchived': 'ops.core.setWorkflowArchived',
  'recordStore.deleteRecords': 'ops.core.deleteRecords',
  'recordStore.rekeyConnection': 'ops.core.rekeyConnection',
  'recordStore.setTypeColor': 'ops.core.colorCanvasType',
  'recordStore.updateRecordField': 'record.update',
};
