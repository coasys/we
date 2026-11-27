/**
 * The host's one password field state, over the port's Solid signals so a Sign in button gated on
 * `entered()` follows the typing. What it is and why it is not template state: `shared/credential.ts`.
 *
 * One per app, at module scope, because the field that writes it (`CredentialField`) and the stores
 * that submit it (session, profile) do not share a provider: `BootController` hands it to the stores.
 */
import { createCredential } from '@shared/credential';
import { solidReactivity } from '@we/reactivity-solid';

export const credential = createCredential(solidReactivity);
