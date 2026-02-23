import { Flag, Model, Property } from '@coasys/ad4m';

import { TestBaseModel } from './TestBaseModel';

/**
 * Derived model — extends TestBaseModel to test model inheritance in scenario 09.
 *
 * Has its own @Flag (test://poll_type) so TestDerivedModel.findAll() correctly
 * discriminates these instances, and its own @Property (question) so the
 * merged getModelMetadata() is testably different from the base class.
 */
@Model({ name: 'TestDerivedModel' })
export class TestDerivedModel extends TestBaseModel {
  @Flag({ through: 'test://poll_type', value: 'test://poll_block' })
  pollType = 'test://poll_block';

  @Property({
    through: 'test://poll_question',
    required: true,
    writable: true,
    initial: 'literal://string:untitled',
  })
  question: string = '';
}
