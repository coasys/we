import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

@Model({ name: 'Signal' })
export class Signal extends Ad4mModel {
  @Flag({ through: 'we://type', value: 'we://signal' })
  type: string = '';

  @Property({ through: 'we://signal_type_id' })
  signalTypeId: string = '';

  @Property({ through: 'we://value' })
  value: number = 0;
}
