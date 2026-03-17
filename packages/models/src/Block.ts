import { Ad4mModel, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

// TODO: see if we can set up Block types (ImageBlock, TextBlock, etc) to extend this base Block model
// Or should we change the name of this to something else if it can wrap non-block models like Agent, Space, Link etc?
// Agent and Space dont seem so relevant but Link needs these collections...
// Or maybe we dont need the wrapper at all, we just add the collections when needed to other models...

@Model({ name: 'Block' })
export class Block extends Ad4mModel {
  @Property({ through: 'we://block_type', required: true })
  type: string = '';

  @HasMany({ through: 'we://has_comments' })
  comments: string[] = [];

  @HasMany({ through: 'we://has_reactions' })
  reactions: string[] = [];
}
export interface Block extends HasManyMethods<'comments' | 'reactions'> {}

// we://has_child
// we://has_descendant (for node tree only needs to connect root to all descendants, for holonic map needs to be used at every level?)

// 1. use has_descendant to grab all nodes (and attached next_sibling links) in a single prolog query
// 2. construct the tree & ordering in the frontend

// if speed of query is not an issue and storage space is tight, don't add has_descendant links to every node, instead retrieve data with recursive query
