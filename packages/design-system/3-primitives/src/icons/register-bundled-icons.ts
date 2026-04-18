import { bundledIcons } from '../generated/icon-bundle';
import { setIconResolver } from '../primitives/icon';
import type { IconWeight } from '../types';

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets';

setIconResolver((name: string, weight: IconWeight): string => {
  const key = `${name}:${weight}`;
  if (key in bundledIcons) return bundledIcons[key];
  // Fallback to CDN for icons not in the bundle
  const fileName = weight === 'regular' ? name : `${name}-${weight}`;
  return `${CDN_BASE}/${weight}/${fileName}.svg`;
});
