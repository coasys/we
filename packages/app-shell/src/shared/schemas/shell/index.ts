/**
 * Shell surfaces re-exported from `@we/template-shell`, plus the schema-test harness.
 *
 * The templates themselves are data and live in `content/`. What remains here is
 * `SchemaTests` — a developer surface whose store and mutation actions are real code
 * (they drive AD4M models and Solid signals to exercise the renderer), so it is not
 * content and does not belong in a content package.
 */
export {
  bootScreen,
  landingPageTemplate,
  marketplaceTemplate,
  CHROME_RAIL_WIDTH,
  chromeRail,
  profileTemplate,
  settingsTemplate,
  sidebar,
  templateEditor,
} from '@we/template-shell';
export { schemaTestsTemplate } from './SchemaTests.schema';
export { schemaMutationActions } from './tests/SchemaMutations.actions';
export { createTestStore } from './tests/testStore';
