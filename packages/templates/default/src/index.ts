/**
 * WE's built-in space templates.
 *
 * A template is a JSON node tree — data, not code — so these ship and version independently of the
 * framework that renders them. That is the whole thesis of the schema system stated as a package
 * boundary: if a template were code, "the app is not the unit" would be a slogan rather than a fact
 * about the build.
 *
 * The only dependency is `@we/schema-shared`, for the `TemplateSchema` type. Nothing here knows what
 * holds the data, which framework renders it, or what a perspective is.
 */
export { defaultTemplate } from './DefaultTemplate';
