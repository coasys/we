import type { SchemaNode } from '@we/schema-shared';
import { installedList } from '@we/template-kit';

export const themesList: SchemaNode = installedList({
  entity: 'Theme',
  as: 'theme',
  label: 'themes',
  emptyIcon: 'paint-brush',
  avatarIcon: '$theme.icon',
  key: '$theme.id',
  activeStorePath: 'themeStore.currentThemeId',
  applyAction: 'themeStore.setCurrentTheme',
  defaultField: 'defaultThemeId',
  refreshAction: 'themeStore.refreshSpaceThemes',
});
