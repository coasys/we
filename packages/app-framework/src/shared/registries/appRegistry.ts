/**
 * App Registry
 *
 * Stores the list of installed embedded apps after they have been resolved
 * from the seed file by initializeIntegrations().
 *
 * Each entry contains the display metadata and the fully-resolved iframe URL
 * (dev server or production Express server), so the AppStore and TemplateProvider
 * don't need to know about platformAdapter or seeds at runtime.
 */

export interface RegisteredApp {
  /** Unique identifier matching seed app.id */
  id: string;
  /** Display name shown in sidebar */
  name: string;
  /** Phosphor icon name for the sidebar button */
  icon: string;
  /** Fully-resolved iframe URL (determined at init time) */
  url: string;
  /** iframe allow attribute value */
  allow: string;
}

/**
 * Populated by initializeIntegrations() before any stores mount.
 * Read-only at runtime — treat as immutable after init.
 */
export const appRegistry: RegisteredApp[] = [];
