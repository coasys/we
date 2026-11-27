/**
 * The lexical scope of the live template's root, for the passes the host mounts away from it.
 *
 * A panel the template declares is a child of the template's root, so it reads the root's local
 * state and draws the root's shapes, as a route does. A route is mounted inside the root's pass and
 * finds that scope through the render tree; a panel is docked wherever the person puts it, outside
 * the template area, so the root publishes its scope here and the panel body takes it from here.
 *
 * A signal, so a body drawn before the root has made its scope (or after a template switch made a
 * new one) is drawn again against it.
 */
import type { PassScope } from '@we/schema-solid';
import { createSignal } from 'solid-js';

const [scope, setScope] = createSignal<PassScope | undefined>(undefined);

/** The live template root's scope, once it has drawn. */
export const templateScope = scope;

/** Called by the template's root pass when its scope is made. */
export const publishTemplateScope = (next: PassScope): void => void setScope(() => next);
