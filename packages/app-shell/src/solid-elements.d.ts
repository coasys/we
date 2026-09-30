// Typed `we-*` JSX intrinsics, generated from the Custom Elements Manifest.
//
// A file rather than a tsconfig `types` entry, deliberately: `types` *replaces* automatic @types
// inclusion, so every package using it also has to remember to list `node`, `vite/client` and
// anything else it relied on — and forgetting produces "Cannot find type definition file for 'node'"
// a long way from the cause. An ambient import is additive and colocated with the code that needs it.
import '@we/primitives/solid/types';
