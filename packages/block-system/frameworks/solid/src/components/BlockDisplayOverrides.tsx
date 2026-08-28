import type { Component, JSX } from 'solid-js';
import { createContext, useContext } from 'solid-js';

type DisplayOverrideMap = Record<string, Component<Record<string, unknown>>>;

const BlockDisplayOverridesContext = createContext<DisplayOverrideMap>({});

/** The raw context, for a composer that must carry the overrides into node views it renders outside the tree. */
export const DisplayOverridesContext = BlockDisplayOverridesContext;

/**
 * Provides display component overrides per block type.
 * Consumers can replace the default display component for any block type
 * without affecting the registered defaults.
 *
 * Usage:
 *   <BlockDisplayOverrides overrides={{ image: MyCustomImageCard }}>
 *     <ReadOnlyComposition content={...} />
 *   </BlockDisplayOverrides>
 */
export function BlockDisplayOverrides(props: { overrides: DisplayOverrideMap; children: JSX.Element }) {
  return (
    <BlockDisplayOverridesContext.Provider value={props.overrides}>
      {props.children}
    </BlockDisplayOverridesContext.Provider>
  );
}

/**
 * Get the display override for a given block type, if any.
 */
export function useDisplayOverride(nodeType: string): Component<Record<string, unknown>> | undefined {
  const overrides = useContext(BlockDisplayOverridesContext);
  return overrides[nodeType];
}
