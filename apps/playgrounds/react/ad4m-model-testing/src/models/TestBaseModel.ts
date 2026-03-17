import { Ad4mModel, Model, Property } from '@coasys/ad4m';

/**
 * Base model — used by scenario 09 to test model inheritance.
 *
 * Intentionally has NO @Flag so that findAll() returns all nodes with its
 * predicate (or, without a discriminant, all nodes). The interesting
 * discrimination happens at the derived level (TestDerivedModel.findAll()
 * uses its own @Flag). This mirrors a real-world base class that provides
 * shared fields without being directly queryable by type.
 */
@Model({ name: 'TestBaseModel' })
export class TestBaseModel extends Ad4mModel {
  @Property({ through: 'test://base_content' })
  content: string = '';
}
