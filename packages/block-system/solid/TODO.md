# Todos

- Shift to this structure and use @we/block-composer/shared, @we/block-composer/solid, @we/block-composer/react etc for imports:

`@we/block-composer/
├── /shared
│   ├── types.ts              # BlockComposerProps, BlockType, etc.
│   ├── serialization.ts      # Lexical <-> AD4M block logic
│   └── nodes/                # Node definitions (platform-agnostic)
├── /solid
│   ├── BlockComposer.tsx
│   ├── plugins/
│   └── index.ts
├── /react
│   ├── BlockComposer.tsx
│   ├── plugins/
│   └── index.ts
└── package.json`
