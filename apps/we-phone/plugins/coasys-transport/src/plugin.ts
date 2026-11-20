import { registerPlugin } from '@capacitor/core';

import type { CoasysTransportPlugin } from './definitions';

/** The native plugin. Kotlin on Android, Swift on iOS, both over the same Rust library. */
export const CoasysTransport = registerPlugin<CoasysTransportPlugin>('CoasysTransport');
