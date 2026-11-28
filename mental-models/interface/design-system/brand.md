# Brand

`@we/brand` holds WE's mark, `we-mark.svg`, and the script that makes every app icon from it. The icon colours come from the `dark` theme preset (`ICON_THEME`), through the ramp arithmetic of `@we/tokens`.

**Why:** The mark has one source, and every icon is output. The icon is the sidebar header on its own: the `page` role behind it and the accent gradient through the mark. These are calculated from the preset, so a change to `accentHue` also changes the icon (`generate.ts`).

**Parent:** [Design system](README.md)

<details><summary>How it works</summary>

1. `pnpm --filter @we/brand generate-icons` runs `src/generate.ts`.
2. The script reads the preset and writes `icon.generated.svg` with the calculated colours.
3. The Tauri CLI rasterises the SVG into the Tauri icon set. The web favicon is the `.ico` file of that set. A second pass makes the Electron icon.
4. The outputs are committed, because the desktop packagers read them from disk. `icon-source.hash` records a hash of the composed SVG, so the script keeps `icon.icns` when the SVG did not change.

</details>

<details><summary>Where in the code</summary>

- [packages/brand/src/generate.ts](../../../packages/brand/src/generate.ts), [packages/brand/src/we-mark.svg](../../../packages/brand/src/we-mark.svg).
- [packages/brand/package.json](../../../packages/brand/package.json).

</details>
