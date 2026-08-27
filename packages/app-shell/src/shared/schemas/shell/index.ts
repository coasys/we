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
/*
  The schema-test harness is deliberately NOT re-exported here.

  A barrel export is a static import for everything that touches the barrel, which is how ~97KB of
  test schemas reached production builds. Its one consumer imports the three modules directly, from
  a file that is itself only ever reached by a dynamic `import()` — see `schemaTestsView`.

  Adding `export { schemaTestsTemplate } from './SchemaTests.schema'` back here would undo it, so
  `schemaTestsExcluded.test.ts` fails on any file but one naming the harness — a re-export counting
  the same as an import, since a barrel is nothing else.
*/
