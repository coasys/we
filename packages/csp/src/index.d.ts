export type Host = 'electron' | 'tauri' | 'web';

export interface ContentSources {
  images: string[];
  media: string[];
  frames: string[];
}

/** The part of a seed this reads — `contentSecurity`, and each app's `paths.webUrl`. */
export interface SeedLike {
  contentSecurity?: Partial<ContentSources>;
  apps?: Array<{ paths?: { webUrl?: string } }>;
}

export const CESIUM_CDN: string;
export const DEFAULT_SOURCES: Readonly<{
  images: readonly string[];
  media: readonly string[];
  frames: readonly string[];
}>;

export function seedSources(seed?: SeedLike): ContentSources;

export function buildContentSecurityPolicy(options?: {
  host?: Host;
  dev?: boolean;
  seed?: SeedLike;
  meta?: boolean;
}): string;
