import type { SchemaNode } from '@we/schema-shared';
import { installedList } from '@we/template-kit';

export const themesList: SchemaNode = installedList({
  entity: 'Theme',
  as: 'theme',
  label: 'themes',
  emptyIcon: 'paint-brush',
  avatarIcon: { $: 'theme.icon' },
  key: { $: 'theme.id' },
  activeStorePath: 'themeStore.currentThemeId',
  // The same act as picking one in the rail, so the same action: applying a theme here pins it to
  // this space rather than setting a signal that the next resolution overwrites.
  applyAction: 'spaceStore.applyTheme',
  defaultField: 'defaultThemeId',
  refreshAction: 'themeStore.refreshSpaceThemes',
});
