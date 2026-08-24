/**
 * Every built-in view, as a validated schema entry point.
 *
 * `we-validate-schemas` walks `.schema.ts` files and descends into whatever they import, which is
 * how the sections were covered while they were routes inside the default template. They are not any
 * more: a shell names its sections with a `$views` marker and resolves them at runtime, so nothing
 * statically imports a view and the walk would reach none of them.
 *
 * That is the cost of runtime resolution, and this file is the payment. It exists so the validator
 * has somewhere to start — every view is exported here, the validator checks every export in a file,
 * and a section with an unknown component or a misspelled role fails the build rather than rendering
 * blank in whichever space happened to enable it.
 *
 * A view installed from a marketplace is beyond this, necessarily: it did not exist when the build
 * ran. It is validated at install instead, which is the same boundary a template already crosses.
 */
export { aboutView, calendarView, cardsView, fluxView, globeView, graphView, tasksView } from './index.ts';
