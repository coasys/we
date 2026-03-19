import { Ad4mModel, HasMany, HasManyMethods, Model } from '@coasys/ad4m';

@Model({ name: 'WeNode' })
export class WeNode extends Ad4mModel {
  @HasMany({ through: 'we://has_comments' })
  comments: string[] = [];

  @HasMany({ through: 'we://has_reactions' })
  reactions: string[] = [];
}

export interface WeNode extends HasManyMethods<'comments' | 'reactions'> {}
