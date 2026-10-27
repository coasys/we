/**
 * Whether this build has developer features at all: the showcase templates, the pretend people on a
 * canvas, the synthetic participants in a call, Settings → Developer.
 *
 * A fact about how the app was built, decided once, by the build. It is on in a development build
 * (`vite` serving), and in any other build made with `WE_DEV_FEATURES=true`, which is how a hosted
 * deploy of work in progress gets them: Netlify's `dev` branch and its pull-request previews set it,
 * production does not. See `scripts/seed-vite.mjs`, which turns it into the constant below, and
 * `scripts/netlify-build.sh`.
 *
 * ## Not `isDevelopment`
 *
 * `sessionStore.isDevelopment` says whether this is a development build, and some things need
 * exactly that: an embedded app is loaded from its dev server only when there is one. A preview is
 * a production build with developer features in it, so the two answers differ there, and a preview
 * that believed it was a dev build would go looking for servers on localhost.
 *
 * ## Why a constant the build writes
 *
 * Because the point is that a production build does not *contain* these things, not merely that it
 * hides them. A template named after a product it imitates is only fine while it ships to nobody.
 * `__WE_DEV_FEATURES__` is replaced by the bundler with `true` or `false`, so in a production build
 * every `DEV_FEATURES ? … : …` folds and what it guarded is never reached; a value read at runtime
 * could hide them and nothing more.
 *
 * Outside a build that defines it (a test, a host loading this package some other way) it is
 * `false`: a host has to ask for developer features, never get them by accident.
 *
 * ## Which things are developer features
 *
 * Each declares it where it is registered: a template in the template catalogue
 * (`generateTemplateRegistry.mjs`), a feature in its own module. This answers only whether the build
 * has them. Whether they are *showing* is `devToolsEnabled`, the switch a developer throws to see
 * what a user sees.
 */
declare const __WE_DEV_FEATURES__: boolean | undefined;

/** Whether this build has developer features. See the module comment. */
export const DEV_FEATURES: boolean = typeof __WE_DEV_FEATURES__ !== 'undefined' && __WE_DEV_FEATURES__ === true;
