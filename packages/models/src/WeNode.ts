import { Ad4mModel, HasMany, HasManyMethods, Model } from '@coasys/ad4m';

import { Signal } from './entities/Signal';

@Model({ name: 'WeNode' })
export class WeNode extends Ad4mModel {
  @HasMany({ through: 'we://comment' })
  comments: string[] = [];

  @HasMany(() => Signal, { through: 'we://signal' })
  signals: string[] = [];
}

export interface WeNode extends HasManyMethods<'comments' | 'signals' | 'reactions'> {}
