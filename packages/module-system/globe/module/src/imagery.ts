/**
 * The globe's imagery settings, read into what `CesiumGlobe` takes.
 *
 * Here rather than in the host because the setting keys are this module's: the host passes in what
 * the settings resolved to and hands the result to the widget. Pure, and free of Cesium, so the
 * module's definition stays cheap to import.
 */

/** A commercial imagery provider and the key to reach it; the widget's `ImageryChoice`. */
export interface ImageryChoice {
  provider: 'ion' | 'esri' | 'mapbox';
  key: string;
}

/** Each provider's key setting. One key per provider, so a choice can never pick up another's key. */
const KEY_SETTING: Record<ImageryChoice['provider'], string> = {
  ion: 'ionAccessToken',
  esri: 'esriApiKey',
  mapbox: 'mapboxAccessToken',
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * The provider chosen and its key, or undefined for NASA's imagery: when NASA is chosen, when nothing
 * is, when the choice is not a provider this knows, or when the chosen provider has no key.
 */
export function imageryChoiceFrom(settings: Record<string, unknown>): ImageryChoice | undefined {
  const provider = settings.imagery;
  if (provider !== 'ion' && provider !== 'esri' && provider !== 'mapbox') return undefined;
  const key = text(settings[KEY_SETTING[provider]]);
  return key ? { provider, key } : undefined;
}

/** The ion token whatever the imagery, for layers that declare `requiresIonAccount`. */
export function ionTokenFrom(settings: Record<string, unknown>): string | undefined {
  return text(settings.ionAccessToken);
}
