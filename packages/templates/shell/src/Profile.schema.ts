import type { TemplateSchema } from '@we/schema-shared';
import { profileEditor, profilePage } from '@we/template-kit';

/**
 * WE's own profile page: the account's, under the settings cog. The page is the kit's, shared with
 * any view of somebody else's profile; here it is bound to the person using the app, and editable.
 */
export const profileTemplate: TemplateSchema = {
  meta: { name: 'Profile', description: 'Agent profile page', icon: 'user' },
  type: '$agent',
  props: { did: { $: 'me.did' }, as: 'person' },
  children: [profilePage({ as: 'person', editable: 'true' })],
};

/** The form on its own, for Settings → Profile. */
export { profileEditor };
