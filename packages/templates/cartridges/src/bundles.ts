import type { Bundle } from '@we/schema-shared';

import { toBundle } from './cartridge.ts';
import { fieldGuide } from './field-guide/index.ts';
import { toolLibrary } from './tool-library/index.ts';

/** Every cartridge, as the bundle checked in under `bundles/`. */
export const cartridgeBundles = (): Bundle[] => [toBundle(fieldGuide), toBundle(toolLibrary)];

/** What a bundle's file is called — `<id>.bundle.json`, the name a seed's `bundles` entry resolves to. */
export const bundleFileName = (id: string): string => `${id}.bundle.json`;
