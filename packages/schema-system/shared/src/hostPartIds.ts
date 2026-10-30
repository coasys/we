/**
 * WE's own chrome pieces an app template places by name — `{ type: '$part', props: { id: 'host.sidebar' } }`.
 *
 * Declared here, in the schema vocabulary, so the validator can check an app template's placements
 * the way it checks a module's parts; the host maps each id to the piece it draws. Only an app
 * template places them — an app's chrome, or its sign-in screen, which is judged as one: a space's
 * template placing the sidebar would draw a second one.
 */
export const HOST_PART_IDS = ['host.sidebar', 'host.rail', 'host.signIn.form', 'host.signIn.accounts'] as const;

export type HostPartId = (typeof HOST_PART_IDS)[number];

export const isHostPartId = (id: string): id is HostPartId => (HOST_PART_IDS as readonly string[]).includes(id);
