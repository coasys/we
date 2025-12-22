# Launcher UI Customization

The WE launcher shell can be fully customized via the `seed.host.ui` configuration. This allows white-labeling of the launcher interface while keeping the embedded apps or native WE templates intact.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         Launcher Shell (Customizable)    │
│  ┌────────────────────────────────────┐ │
│  │  Boot Screen                        │ │  ← Custom via seed
│  │  App Settings                       │ │  ← Custom via seed
│  └────────────────────────────────────┘ │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  Content (Auto-detected)            │ │
│  │                                     │ │
│  │  • Embedded Apps (has seed.apps)   │ │
│  │    - Sidebar + iframe routes       │ │
│  │    - Template switching: DISABLED  │ │
│  │                                     │ │
│  │  • Native WE App (no seed.apps)    │ │
│  │    - User-switchable templates     │ │
│  │    - Template switching: ENABLED   │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Configuration

### Basic Example

```json
{
  "project": {
    "name": "My Custom Launcher",
    "version": "1.0.0"
  },
  "host": {
    "ui": {
      "bootScreen": {
        "type": "Column",
        "props": { "width": "100%", "height": "100%", "ax": "center", "ay": "center" },
        "children": [
          { "type": "we-text", "props": { "size": "800" }, "children": ["My Brand"] },
          { "type": "we-spinner", "props": { "size": "lg" } },
          { "type": "we-text", "children": ["Loading..."] }
        ]
      },
      "enableTemplateSwitching": false
    }
  },
  "apps": [
    { "id": "flux", "name": "Flux", "route": "/flux", ... }
  ]
}
```

## Customization Options

### `host.ui.bootScreen`

Custom schema for the boot/login screen shown before AD4M is ready.

**Default behavior**: Shows WE logo, loading spinner, and login form.

**Example - Custom branding**:

```json
{
  "host": {
    "ui": {
      "bootScreen": {
        "type": "$if",
        "props": {
          "condition": { "$ne": [{ "$store": "adamStore.bootState" }, "ready"] },
          "then": {
            "type": "Column",
            "props": {
              "width": "100%",
              "height": "100%",
              "ax": "center",
              "ay": "center",
              "bg": "primary-500"
            },
            "children": [
              { "type": "we-text", "props": { "size": "900", "color": "white" }, "children": ["ACME Corp"] },
              { "type": "we-spinner", "props": { "size": "xl", "color": "white" } }
            ]
          }
        }
      }
    }
  }
}
```

### `host.ui.appSettings`

Custom schema for the app settings modal (gear icon in bottom-right).

**Default behavior**:

- Shows theme switcher (always)
- Shows template switcher (only if `enableTemplateSwitching` is true)

**Example - Minimal settings**:

```json
{
  "host": {
    "ui": {
      "appSettings": {
        "children": [
          {
            "type": "we-button",
            "props": {
              "position": "absolute",
              "bottom": "10px",
              "right": "10px",
              "onClick": { "$action": "modalStore.openModal", "args": ["app-settings"] }
            },
            "children": [{ "type": "we-icon", "props": { "name": "gear" } }]
          },
          {
            "type": "$if",
            "props": {
              "condition": { "$store": "modalStore.appSettingsModalOpen" },
              "then": {
                "type": "we-modal",
                "props": { "close": { "$action": "modalStore.closeModal", "args": ["app-settings"] } },
                "children": [
                  { "type": "we-text", "children": ["Settings"] },
                  { "type": "we-text", "props": { "size": "300" }, "children": ["Theme and preferences coming soon"] }
                ]
              }
            }
          }
        ]
      }
    }
  }
}
```

### `host.ui.enableTemplateSwitching`

Control whether users can switch between templates in app settings.

**Default behavior**:

- `false` if `seed.apps.length > 0` (embedded apps mode)
- `true` if `seed.apps.length === 0` (native WE app mode)

**Override example**:

```json
{
  "host": {
    "ui": {
      "enableTemplateSwitching": true // Force enable even with embedded apps
    }
  }
}
```

**Note**: Enabling template switching with embedded apps may cause layout conflicts. Only do this if your custom templates are designed to work with iframes.

## Mode Detection

The launcher automatically detects its mode based on the seed configuration:

### Embedded Apps Mode

- **Triggered by**: `seed.apps.length > 0`
- **Behavior**:
  - Generates sidebar + iframe routes
  - Disables template switching (unless explicitly enabled)
  - Perfect for bundling multiple external apps

### Native WE App Mode

- **Triggered by**: `seed.apps.length === 0`
- **Behavior**:
  - Enables template switching
  - Users can build AD4M-powered apps with WE primitives
  - Full access to template registry (default, twitter, custom, etc.)

## Implementation Details

### Registry System

UI customizations are registered in `launcherUIRegistry`:

```typescript
import { launcherUIRegistry } from '@we/app-framework/shared';

// Access current schemas
const bootScreen = launcherUIRegistry.bootScreen;
const appSettings = launcherUIRegistry.appSettings;
const canSwitchTemplates = launcherUIRegistry.enableTemplateSwitching;
```

### Initialization Flow

1. **Module load**: Default schemas registered
2. **PlatformProvider mounts**: Calls `initializeIntegrations(adapter)`
3. **Seed loaded**: Custom UI schemas override defaults
4. **Mode detected**: Template switching enabled/disabled
5. **TemplateProvider**: Builds app layout with registry schemas

### File Structure

```
packages/app-framework/src/shared/
├── schemas/
│   ├── defaults/               ← Default launcher UI fragments
│   │   ├── BootScreen.schema.ts
│   │   └── AppSettings.schema.ts
│   ├── DefaultTemplate.schema.ts  ← User-switchable templates
│   ├── TwitterTemplate.schema.ts
│   └── ...
├── registries/
│   ├── launcherUIRegistry.ts   ← Holds customizable shell UI
│   └── templateRegistry.ts     ← Holds user-switchable templates
└── initializeIntegrations.ts   ← Applies seed customizations
```

## Best Practices

1. **Keep it simple**: Start with default schemas, only customize what you need
2. **Test both modes**: Verify your customizations work in embedded and native modes
3. **Respect the structure**: Boot screen should handle all boot states, app settings should use modal pattern
4. **Use schema references**: Leverage `$store`, `$action`, `$if` for dynamic behavior
5. **Consider mobile**: Test responsive layouts on different screen sizes

## Advanced: Custom Components

For more complex customizations, you can:

1. Create custom components in the component registry
2. Reference them in your seed schemas
3. Build completely custom launcher experiences

See `componentRegistry.tsx` for available components.
