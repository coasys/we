# WE Design System Packages

Welcome to the **WE Design System**! This directory contains the foundational packages that power the UI, theming, and component experience across all WE applications and modules.

## Overview

The design system is organized as a set of composable, reusable packages, each with a clear responsibility. It enables rapid development, consistent user experience, and easy theming for community-driven apps built on the WE platform.

## Packages

- **1-tokens/**: Centralized design tokens for spacing, color, typography, etc.
- **2-themes/**: Theme definitions and utilities for light/dark/custom themes.
- **3-primitives/**: Atomic, reusable web components. Framework-agnostic, can be used in any JS app.
- **4-components/**: Higher-level UI components for SolidJS, composed from elements and tokens.
- **5-widgets/**: Composite UI blocks that encapsulate specific functionality (e.g., search bars, carousels, chat panels). Widgets combine multiple components and elements to deliver higher-level features. This is the highest level of the design system — composition above widgets is handled by the schema system.
- **types/**: All designs system types
- **utils/**: All designs system utils

## Usage

Each package is published independently and can be installed via npm or pnpm. See the README in each subpackage for usage details and API docs.

## Contributing

We welcome contributions! To add or update a component, element, or theme:

1. Fork the repo and create a branch.
2. Add your code in the appropriate package directory.
3. Write or update stories and tests.
4. Run `pnpm build` and ensure all packages build and tests pass.
5. Submit a pull request with a clear description.

See the [CONTRIBUTING.md](../../CONTRIBUTING.md) for more details.

## Storybook

We use a monorepo-level Storybook for live documentation and development of all design system packages. Run `pnpm storybook` from the repo root to start the Storybook server.

## License

MIT. See [LICENSE](../../LICENSE).

---

For questions or suggestions, open an issue or join the WE community!
