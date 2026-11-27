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

  // Writes that are declared operations.
  'spaceStore.createPost': 'ops.core.createPost',
  'spaceStore.setInvolvement': 'ops.core.setInvolvement',
  'spaceStore.openBoardFor':
    'ops.core.openBoardFor, for a collection’s board (the space’s own board stays a store action)',
  'spaceStore.removeBoardColumn': 'ops.core.removeBoardColumn',
  'spaceStore.moveCardToColumn': 'ops.core.moveCard',
  'spaceStore.addTaskToColumn': 'ops.core.addTaskToColumn',
  'spaceStore.createTaskState': 'ops.core.createTaskState',
  'spaceStore.updateTaskState': 'ops.core.updateTaskState',
  'spaceStore.setTaskStateRetired': 'ops.core.setTaskStateRetired',
  'spaceStore.reorderTaskStates': 'ops.core.reorderTaskStates',
  'spaceStore.createInvolvementType': 'ops.core.createInvolvementType',
  'spaceStore.updateInvolvementType': 'ops.core.updateInvolvementType',
  'spaceStore.setInvolvementTypeRetired': 'ops.core.setInvolvementTypeRetired',
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
