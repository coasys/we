/**
 * What a space made in Coasys starts with — the starter the bundle carries, which a deployment
 * building Coasys in applies to every space made while Coasys is the app in use.
 *
 * The space template and theme are named by their ids in the bundle (`space`, `glow`) and land on the
 * bundle's own pieces. The `canvas` landmark is what the space's Canvas page places cards on, over
 * everything filed into the space; `board` is the task board's.
 */
import type { SpaceStarter } from '@we/schema-shared';

export const coasysStarter: SpaceStarter = {
  id: 'coasys-default',
  name: 'Coasys space',
  // Read in the create dialog while somebody is in Coasys: what the kit gives, in Coasys's own words,
  // and that it is a start rather than a commitment.
  title: "Comes with Coasys's starter kit",
  description:
    "Social DNA for likes, tasks and who's involved, a canvas and a task board, and calls read for the work that comes out of them. You can change any of it later.",
  icon: 'dna',
  settings: {
    defaultTemplateId: 'space',
    defaultThemeId: 'glow',
    autoInterpret: true,
    extractionTargets: ['TaskBlock', 'EventBlock', 'Relationship'],
    taskStates: ['$todo', '$doing', '$done'],
  },
  records: [
    {
      entity: 'SignalType',
      fields: {
        name: 'Like',
        slug: 'like',
        description: 'The ordinary yes — you read it and you are glad it is here.',
        icon: 'heart',
        mode: 'toggle',
        aggregate: 'count',
        semantic: 'approval',
        rangeMin: 0,
        rangeMax: 1,
      },
    },
    {
      $id: 'todo',
      entity: 'TaskState',
      fields: {
        name: 'To do',
        slug: 'todo',
        semantic: 'open',
      },
    },
    {
      $id: 'doing',
      entity: 'TaskState',
      fields: {
        name: 'Doing',
        slug: 'doing',
        semantic: 'active',
      },
    },
    {
      $id: 'done',
      entity: 'TaskState',
      fields: {
        name: 'Done',
        slug: 'done',
        semantic: 'done',
      },
    },
    {
      entity: 'InvolvementType',
      fields: {
        name: 'Assigned',
        slug: 'assignee',
        semantic: 'responsible',
        reflexive: false,
        appliesTo: 'TaskBlock',
        icon: 'user-circle-check',
      },
    },
    {
      entity: 'InvolvementType',
      fields: {
        name: 'Reviewing',
        slug: 'reviewer',
        semantic: 'reviewing',
        reflexive: false,
        appliesTo: 'TaskBlock',
        icon: 'eye',
      },
    },
    {
      entity: 'InvolvementType',
      fields: {
        name: 'Going',
        slug: 'going',
        semantic: 'committed',
        reflexive: true,
        appliesTo: 'EventBlock',
        icon: 'check-circle',
      },
    },
    {
      entity: 'InvolvementType',
      fields: {
        name: 'Maybe',
        slug: 'maybe',
        semantic: 'interested',
        reflexive: true,
        appliesTo: 'EventBlock',
        icon: 'question',
      },
    },
    {
      entity: 'InvolvementType',
      fields: {
        name: 'Not going',
        slug: 'not-going',
        semantic: 'declined',
        reflexive: true,
        appliesTo: 'EventBlock',
        icon: 'x-circle',
      },
    },
    {
      $id: 'canvas',
      entity: 'CollectionBlock',
      fields: {
        kind: 'canvas',
        title: 'Canvas',
      },
      in: '$root',
    },
    {
      $id: 'board',
      entity: 'CollectionBlock',
      fields: {
        kind: 'board',
        mode: 'feed',
        title: 'Everything',
        gathers: ['$root'],
      },
      in: '$root',
    },
    {
      entity: 'CollectionBlock',
      fields: {
        kind: 'column',
        mode: 'feed',
        title: '',
        slug: 'todo',
      },
      in: '$board',
    },
    {
      entity: 'CollectionBlock',
      fields: {
        kind: 'column',
        mode: 'feed',
        title: '',
        slug: 'doing',
      },
      in: '$board',
    },
    {
      entity: 'CollectionBlock',
      fields: {
        kind: 'column',
        mode: 'feed',
        title: '',
        slug: 'done',
      },
      in: '$board',
    },
  ],
  landmarks: {
    canvas: '$canvas',
    board: '$board',
  },
  input: true,
};
