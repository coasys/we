/**
 * The bundles this deployment builds in, as the pieces the built-in registries take.
 *
 * A seed bundle is built in, the way WE's own templates are: its app, space templates, sections,
 * pages and theme join the registries — read-only, forkable, and updated by every deploy, with nothing written
 * for any agent. The deployment chose to ship it, so nobody is asked; a bundle someone installs from a
 * file goes through the install screen instead, and lands in their library.
 *
 * What cannot be built in is a record type: those belong to a space, and are added to one by whoever
 * runs it.
 */
import { type BundlePieces, bundlePieces } from '../bundles/bundlePieces';
import { seedBundles } from './seedBundles.generated';

export const seedBundlePieces: readonly BundlePieces[] = seedBundles.map(bundlePieces);

const byId = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

export const seedBundleApps = byId(seedBundlePieces.flatMap((pieces) => (pieces.app ? [pieces.app] : [])));
export const seedBundleShells = byId(seedBundlePieces.flatMap((pieces) => pieces.shells));
export const seedBundleSections = byId(seedBundlePieces.flatMap((pieces) => pieces.sections));
export const seedBundlePages = byId(seedBundlePieces.flatMap((pieces) => pieces.pages));
export const seedBundleThemes = byId(seedBundlePieces.flatMap((pieces) => pieces.themes));

/**
 * The app the deployment opens in when the seed's `host.ui.app` names none: the first seed bundle that
 * brings one. A deployment shipping a bundle with an app means it to be the app.
 */
export const seedBundleAppId: string | undefined = seedBundlePieces.find((pieces) => pieces.app)?.app?.id;
