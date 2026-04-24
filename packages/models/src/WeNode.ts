import { Ad4mModel, HasMany, HasManyMethods, Model } from '@coasys/ad4m';

@Model({ name: 'WeNode' })
export class WeNode extends Ad4mModel {
  @HasMany({ through: 'we://has_comments' })
  comments: string[] = [];

  @HasMany({ through: 'we://has_signals' })
  signals: string[] = [];
}

export interface WeNode extends HasManyMethods<'comments' | 'signals' | 'reactions'> {}
