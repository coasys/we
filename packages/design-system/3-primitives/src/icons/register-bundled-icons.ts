import { bundledIcons } from '../generated/icon-bundle';
import { buildCdnUrl, setIconResolver } from '../primitives/icon';
import type { IconWeight } from '../types';

setIconResolver((name: string, weight: IconWeight): string => {
  const key = `${name}:${weight}`;
  if (key in bundledIcons) return bundledIcons[key];
  // Fallback to CDN for icons not in the bundle
  return buildCdnUrl(name, weight);
});
