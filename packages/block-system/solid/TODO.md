# Todos

- ~~Restructure into shared/solid sub-packages~~ ✅ (Done — `@we/block-shared` + `@we/block-solid`)

Current structure:
```
block-system/
├── shared/     → @we/block-shared (types, serialization)
├── solid/      → @we/block-solid (BlockComposer, plugins)
└── models/     → @we/models (AD4M model definitions)
```
